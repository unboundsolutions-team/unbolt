/**
 * Apply pending migrations.
 *
 * ── Why this exists, late ───────────────────────────────────────────
 * Since M0 this repository has asserted — in drizzle.config.ts, in
 * sync-migrations.ts, in the preflight and in my own notes — that "Netlify
 * applies migrations before publishing a deploy". That was never checked, and
 * it is not true. `@netlify/database` is a connection helper with no migration
 * code in it, netlify.toml declares no build plugin, and the build command is
 * `next build` and nothing else.
 *
 * The consequence, had it gone unnoticed: the first deploy comes up against an
 * empty database and every page that reads data returns 500, with the build
 * itself reporting success.
 *
 * So the deploy applies them, explicitly, as a build step. `netlify.toml` runs
 * `npm run db:migrate && next build`, which means a failed migration fails the
 * build and nothing publishes — the behaviour everyone already believed they
 * had.
 *
 * ── Why over TCP rather than the app's own client ───────────────────
 * The app talks to Neon over HTTP, which has no transactions. DDL without a
 * transaction can half-apply: a migration that creates a table and then fails
 * on an index leaves the schema in a state no migration file describes. `pg`
 * over TCP is a real session, so each file runs inside BEGIN/COMMIT and either
 * lands completely or not at all.
 *
 * ── Why this is .mjs and not .ts ────────────────────────────────────
 * Every other script here runs through tsx, which depends on esbuild, which
 * needs a platform binary fetched by a postinstall script. npm 11 blocks
 * postinstall scripts by default, and when it does, tsx cannot run at all —
 * so every tsx script fails at once, including this one.
 *
 * That is an acceptable failure for a contrast checker. It is not acceptable
 * for the thing the deploy runs before it publishes. This file uses `pg` and
 * node builtins and nothing else, so it works on a bare `npm install` with
 * every optional step blocked.
 *
 *   npm run db:migrate                 # NETLIFY_DATABASE_URL or DEVELOPMENT_DATABASE_URL
 *   npm run db:migrate -- --dry-run    # say what would run, change nothing
 *   npm run db:migrate -- --baseline   # record as applied WITHOUT running
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import pg from "pg";

const MIGRATIONS = join("netlify", "database", "migrations");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const baseline = args.includes("--baseline");
const urlFlag = args.indexOf("--url");

const connectionString =
  (urlFlag >= 0 ? args[urlFlag + 1] : undefined) ??
  process.env["NETLIFY_DATABASE_URL"] ??
  process.env["DEVELOPMENT_DATABASE_URL"];

if (!connectionString) {
  console.error(
    "No database URL.\n\n" +
      "Set NETLIFY_DATABASE_URL (the Neon URL from Netlify → Database) or\n" +
      "DEVELOPMENT_DATABASE_URL (a local Postgres), or pass --url.",
  );
  process.exit(2);
}

function sha(contents) {
  // Same normalisation as sync-migrations.ts, so a Windows checkout does not
  // read as a rewrite of every file.
  return createHash("sha256").update(contents.replace(/\r\n/g, "\n")).digest("hex");
}

function onDisk() {
  if (!existsSync(MIGRATIONS)) return [];
  return readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    // Lexicographic order is apply order — the timestamp prefix guarantees it.
    .sort()
    .flatMap((name) => {
      const file = join(MIGRATIONS, name, "migration.sql");
      if (!existsSync(file)) return [];
      const sql = readFileSync(file, "utf8");
      return [{ name, sql, hash: sha(sql) }];
    });
}

async function main() {
  const client = new pg.Client({
    connectionString,
    // Neon requires TLS. Certificates are publicly valid, so this verifies
    // them rather than passing rejectUnauthorized: false — which is the usual
    // shortcut here and quietly accepts any certificate.
    ssl: /sslmode=require|neon\.tech|db\.netlify\.com/.test(connectionString)
      ? { rejectUnauthorized: true }
      : false,
  });

  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        hash text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const applied = new Map(
      (await client.query(`SELECT name, hash FROM schema_migrations`)).rows.map((r) => [
        r.name,
        r.hash,
      ]),
    );

    const migrations = onDisk();
    if (migrations.length === 0) {
      console.log("No migrations found.");
      return;
    }

    // An applied migration whose file has changed is the one thing that must
    // stop everything: production and this checkout now disagree about what the
    // schema is, and no later migration can be trusted to apply cleanly.
    const changed = migrations.filter(
      (m) => applied.has(m.name) && applied.get(m.name) !== m.hash,
    );
    if (changed.length > 0) {
      console.error(
        "Refusing to continue — these have already been applied but their " +
          "contents have changed:\n" +
          changed.map((m) => `  ✗ ${m.name}`).join("\n") +
          "\n\nAn applied migration is immutable. Add a new one instead.",
      );
      process.exit(1);
    }

    const pending = migrations.filter((m) => !applied.has(m.name));

    if (pending.length === 0) {
      console.log(`✓ Up to date — ${applied.size} migration(s) applied.`);
      return;
    }

    if (dryRun) {
      console.log(`${pending.length} migration(s) would run:`);
      for (const m of pending) console.log(`  → ${m.name}`);
      return;
    }

    if (baseline) {
      // For a database whose schema was built before this runner existed —
      // every local one, and any that was migrated by hand. Records them as
      // applied so the next real migration is the only thing that runs.
      for (const m of pending) {
        await client.query(`INSERT INTO schema_migrations (name, hash) VALUES ($1, $2)`, [
          m.name,
          m.hash,
        ]);
        console.log(`  recorded ${m.name}`);
      }
      console.log(`\n✓ Baselined ${pending.length} migration(s). Nothing was executed.`);
      return;
    }

    for (const m of pending) {
      process.stdout.write(`  applying ${m.name} … `);
      // One transaction per file. A migration that fails partway leaves the
      // database exactly as it was, rather than in a state no file describes.
      await client.query("BEGIN");
      try {
        await client.query(m.sql);
        await client.query(`INSERT INTO schema_migrations (name, hash) VALUES ($1, $2)`, [
          m.name,
          m.hash,
        ]);
        await client.query("COMMIT");
        console.log("ok");
      } catch (error) {
        await client.query("ROLLBACK");
        console.log("FAILED");
        throw error;
      }
    }

    console.log(`\n✓ Applied ${pending.length} migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("\nMigration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
