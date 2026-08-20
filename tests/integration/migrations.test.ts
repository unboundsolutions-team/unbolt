import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CONNECTION } from "./setup-db";

/**
 * Every migration must survive being applied twice — and must still apply the
 * first time.
 *
 * ── Why this is worth a whole scratch database ──────────────────────
 * Two independent systems apply these files. Netlify applies them before it
 * publishes a deploy and keeps its own record of what it has run;
 * `npm run db:migrate` applies them from a laptop and keeps ours in
 * schema_migrations. Neither can see the other's record.
 *
 * Applying the schema by hand and then deploying was enough to wedge the site
 * permanently. Netlify's record was empty, so it started from the first
 * migration against a database that already had everything, and got
 *
 *     pq: type "org_role" already exists
 *
 * A failed migration blocks the publish, so every subsequent deploy failed the
 * same way — and retrying could not help, because the disagreement was between
 * two ledgers rather than inside either one.
 *
 * The fix is that each file skips itself when its work is already present.
 * `npm run db:check` asserts the guard is THERE; only running the migrations
 * twice asserts the guard is RIGHT. A predicate naming an object the migration
 * does not create, or one another migration also creates, passes the static
 * check and wedges the deploy exactly as before. That is not hypothetical:
 * migration 5 recreates an index that migration 3 already created under the
 * same name, so the obvious predicate for it is the wrong one.
 *
 * ── Why there are three databases and not two ───────────────────────
 * "No error on the second run" is too weak, and so is comparing a one-pass
 * database against a two-pass one. Both are built from the same files, so a
 * guard that is true BEFORE its own migration has run makes that migration
 * skip on every pass — identically on both databases — and the comparison
 * still matches while the schema is quietly missing a column.
 *
 * That is not a theoretical hole. The first version of this test compared only
 * those two, and it passed with migration 5 guarded on
 * `notifications_pending_idx` — an index migration 3 already created, so
 * migration 5 never ran at all and `notifications.claimed_until` never
 * existed.
 *
 * The third database is the control: the same files with every guard forced
 * off, which is exactly the SQL these migrations were before the guards were
 * added. Comparing the guarded one-pass database against it is what proves the
 * guards skip only work that is genuinely already done.
 */

const MIGRATIONS = join("netlify", "database", "migrations");

function migrationFiles(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    // Lexicographic order is apply order, as it is for both real runners.
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(join(MIGRATIONS, name, "migration.sql"), "utf8"),
    }));
}

/**
 * The same file with its guard forced never to fire — the control.
 *
 * Rewriting the predicate to `false` rather than cutting the wrapper out keeps
 * the body byte-identical, so the control differs from the real migration in
 * exactly one thing: whether the skip can happen.
 */
function withoutGuard(sql: string): string {
  const stripped = sql.replace(/\nBEGIN\nIF [\s\S]*?\nEND IF;\n/, "\nBEGIN\n");
  if (stripped === sql) {
    throw new Error(
      "Could not find the guard to strip. The wrapper's shape has changed, " +
        "and this test is silently no longer a control — fix the pattern.",
    );
  }
  return stripped;
}

/**
 * Everything that defines the shape of the database, as comparable text.
 *
 * information_schema plus pg_indexes rather than shelling out to pg_dump: the
 * tests should not need a matching client binary on PATH, and pg_dump's output
 * carries a per-run token that would have to be filtered out anyway.
 */
async function describeSchema(client: pg.Client): Promise<string> {
  const parts: string[] = [];

  const columns = await client.query(
    `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, column_name`,
  );
  for (const r of columns.rows) {
    parts.push(
      `column ${r.table_name}.${r.column_name} ${r.data_type}/${r.udt_name} ` +
        `null=${r.is_nullable} default=${r.column_default ?? "-"}`,
    );
  }

  const indexes = await client.query(
    `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`,
  );
  for (const r of indexes.rows) parts.push(`index ${r.indexname} ${r.indexdef}`);

  const constraints = await client.query(
    `SELECT conrelid::regclass::text AS tbl, conname, pg_get_constraintdef(oid) AS def
       FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace
      ORDER BY 1, 2`,
  );
  for (const r of constraints.rows) parts.push(`constraint ${r.tbl}.${r.conname} ${r.def}`);

  const enums = await client.query(
    `SELECT t.typname, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS labels
       FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
       JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
      GROUP BY t.typname ORDER BY t.typname`,
  );
  for (const r of enums.rows) parts.push(`enum ${r.typname} (${r.labels})`);

  const triggers = await client.query(
    `SELECT c.relname AS tbl, t.tgname
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public'
      ORDER BY 1, 2`,
  );
  for (const r of triggers.rows) parts.push(`trigger ${r.tbl}.${r.tgname}`);

  const rules = await client.query(
    `SELECT tablename, rulename FROM pg_rules WHERE schemaname = 'public' ORDER BY 1, 2`,
  );
  for (const r of rules.rows) parts.push(`rule ${r.tablename}.${r.rulename}`);

  return parts.join("\n");
}

// The scratch databases are created next to TEST_DATABASE_URL, on the same
// server, and dropped afterwards. They must not be the test database itself —
// applying migrations to it mid-suite would pull the world out from under
// every other file.
const suite = CONNECTION ? describe : describe.skip;

suite("migrations are re-runnable", () => {
  const admin = new pg.Client({ connectionString: CONNECTION ?? "postgres://invalid" });
  const names = {
    once: "unbolt_mig_once",
    twice: "unbolt_mig_twice",
    control: "unbolt_mig_control",
  };

  function urlFor(database: string): string {
    const url = new URL(CONNECTION ?? "postgres://invalid");
    url.pathname = `/${database}`;
    return url.toString();
  }

  async function applyAll(
    database: string,
    passes: number,
    transform: (sql: string) => string = (sql) => sql,
  ): Promise<void> {
    const client = new pg.Client({ connectionString: urlFor(database) });
    await client.connect();
    try {
      for (let pass = 0; pass < passes; pass += 1) {
        for (const m of migrationFiles()) {
          try {
            await client.query(transform(m.sql));
          } catch (error) {
            throw new Error(
              `${m.name} failed on pass ${pass + 1} of ${passes}: ` +
                (error instanceof Error ? error.message : String(error)),
            );
          }
        }
      }
    } finally {
      await client.end();
    }
  }

  beforeAll(async () => {
    await admin.connect();
    for (const db of Object.values(names)) {
      await admin.query(`DROP DATABASE IF EXISTS ${db}`);
      await admin.query(`CREATE DATABASE ${db}`);
    }
    await applyAll(names.once, 1);
    await applyAll(names.twice, 2);
    await applyAll(names.control, 1, withoutGuard);
  }, 120_000);

  afterAll(async () => {
    for (const db of Object.values(names)) {
      await admin.query(`DROP DATABASE IF EXISTS ${db}`).catch(() => undefined);
    }
    await admin.end();
  });

  async function schemaOf(database: string): Promise<string> {
    const client = new pg.Client({ connectionString: urlFor(database) });
    await client.connect();
    try {
      return await describeSchema(client);
    } finally {
      await client.end();
    }
  }

  it("skips nothing on a database that has never been migrated", async () => {
    const guarded = await schemaOf(names.once);
    const control = await schemaOf(names.control);
    // A comparison of two empty strings would prove nothing.
    expect(control).not.toBe("");
    expect(guarded).toBe(control);
  });

  it("applies cleanly a second time, and changes nothing when it does", async () => {
    const once = await schemaOf(names.once);
    const twice = await schemaOf(names.twice);
    expect(once).not.toBe("");
    expect(twice).toBe(once);
  });

  it("seeds the plans exactly once", async () => {
    // The one migration that inserts rows. If its guard were wrong this would
    // be three plans duplicated rather than an error, and nothing else in the
    // suite would notice.
    const twice = new pg.Client({ connectionString: urlFor(names.twice) });
    await twice.connect();
    try {
      const { rows } = await twice.query<{ code: string; n: string }>(
        `SELECT code, count(*)::text AS n FROM plans GROUP BY code ORDER BY code`,
      );
      expect(rows.map((r) => r.code).sort()).toEqual([
        "enterprise",
        "professional",
        "standard",
      ]);
      expect(rows.every((r) => r.n === "1")).toBe(true);
    } finally {
      await twice.end();
    }
  });

  it("guards on something each migration itself creates", () => {
    // The static half of the check, kept here too so a failure reads as one
    // story: `npm run db:check` enforces it in CI, but a developer running
    // only the tests should still see it.
    for (const m of migrationFiles()) {
      expect(m.sql, `${m.name} is not wrapped in the re-runnable guard`).toContain(
        "$unbolt_migration$",
      );
    }
  });
});
