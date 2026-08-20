/**
 * Reshape drizzle-kit output into the layout Netlify DB expects, and refuse to
 * let an already-applied migration be edited.
 *
 * drizzle-kit writes    drizzle/0000_slug.sql
 * this reshapes to      netlify/database/migrations/<timestamp>_<slug>/migration.sql
 *
 * Netlify applies them on deploy, in a platform build step that reads this
 * directory — visible in a build log as 'Netlify Database setup'. Locally,
 * `npm run db:migrate` does the same job against a database you name.
 *
 * (This comment has now been wrong in both directions. It first claimed
 * Netlify applied them with no evidence, then claimed it did not after an
 * audit that only looked inside the repository. The build log settled it.)
 *
 * Once applied, a migration is effectively immutable: rewriting one means
 * production and preview databases disagree about history. Every migration is
 * hashed into a lockfile here and CI fails when a recorded hash changes. The
 * runner checks the same thing against what the database says it applied.
 *
 *   npm run db:sync     reshape + record
 *   npm run db:check    verify only (used by CI)
 *   npm run db:sync -- --repair   re-record hashes after a provably neutral edit
 */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const DRIZZLE_OUT = "drizzle";
const NETLIFY_MIGRATIONS = join("netlify", "database", "migrations");
const LOCKFILE = join(NETLIFY_MIGRATIONS, ".applied.json");

const checkOnly = process.argv.includes("--check");

/*
 * The same escape hatch the runner has, and for the same one reason: an edit
 * that cannot change any database still changes the hash. Both tools need it,
 * or repairing one leaves the other refusing — which is the shape of problem
 * this whole change exists to remove.
 */
const repair = process.argv.includes("--repair");

type Lock = Record<string, string>;

function sha(contents: string): string {
  // Normalise line endings so a checkout on Windows does not read as a rewrite.
  return createHash("sha256").update(contents.replace(/\r\n/g, "\n")).digest("hex");
}

function readLock(): Lock {
  if (!existsSync(LOCKFILE)) return {};
  return JSON.parse(readFileSync(LOCKFILE, "utf8")) as Lock;
}

/** `0003_lively_magneto.sql` → `lively_magneto` */
function slugOf(filename: string): string {
  return filename.replace(/^\d+_/, "").replace(/\.sql$/, "");
}

/** UTC compact stamp; migrations sort lexicographically in apply order. */
function stamp(index: number): string {
  const now = new Date();
  const base = now.toISOString().replace(/[-:T]/g, "").slice(0, 8);
  return `${base}${String(index).padStart(6, "0")}`;
}

function existingDirs(): string[] {
  if (!existsSync(NETLIFY_MIGRATIONS)) return [];
  return readdirSync(NETLIFY_MIGRATIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function main(): void {
  mkdirSync(NETLIFY_MIGRATIONS, { recursive: true });

  const lock = readLock();
  const violations: string[] = [];

  // 1. Verify nothing already recorded has been edited.
  for (const dir of existingDirs()) {
    const file = join(NETLIFY_MIGRATIONS, dir, "migration.sql");
    if (!existsSync(file)) {
      violations.push(`${dir}: migration.sql is missing`);
      continue;
    }
    const digest = sha(readFileSync(file, "utf8"));
    const recorded = lock[dir];
    if (recorded && recorded !== digest) {
      if (repair && !checkOnly) {
        lock[dir] = digest;
        console.log(`  rehashed ${dir}`);
      } else {
        violations.push(
          `${dir}: already applied but its contents changed. ` +
            `Applied migrations are immutable — add a new migration instead. ` +
            `If the edit provably cannot change a database that already ran it, ` +
            `\`npm run db:sync -- --repair\` re-records the hash.`,
        );
      }
    }
    /*
     * Every migration must be re-runnable.
     *
     * Two systems apply these — Netlify before it publishes a deploy, and
     * `npm run db:migrate` from a laptop — and each keeps a private record of
     * what it has run. Once those records disagree, one of them re-runs a
     * migration the other already applied, the raw `CREATE TYPE` fails with
     * `type "org_role" already exists`, and the publish is blocked with no way
     * to clear it from either side. That happened, and it took the site down
     * before it ever came up.
     *
     * The wrapper makes "already applied" a fact about the database instead of
     * about whichever ledger is asking. A migration written without it puts
     * the deploy one hand-run away from being wedged again, so this is a
     * blocker rather than a warning.
     */
    const contents = readFileSync(file, "utf8");
    if (!contents.includes("$unbolt_migration$")) {
      violations.push(
        `${dir}: not wrapped in the re-runnable guard. Copy the DO ` +
          `$unbolt_migration$ prologue from any existing migration and pick a ` +
          `predicate that is true once this one has run — normally the last ` +
          `object it creates.`,
      );
    }

    /*
     * An unrecorded migration is a violation in check mode, not something to
     * pass over.
     *
     * The old code skipped it: no recorded hash, no comparison, no complaint —
     * and then printed "N migration(s) intact" counting it. Two hand-written
     * migrations sat outside the lockfile that way while CI asserted all ten
     * were protected. Since these are written by hand as often as by
     * drizzle-kit, "somebody will remember to run db:sync" is not a guarantee,
     * and the migrations most likely to still be edited are exactly the newest
     * ones this was failing to cover.
     */
    if (!recorded) {
      if (checkOnly) {
        violations.push(
          `${dir}: not recorded in the lockfile, so an edit to it would go ` +
            `undetected. Run \`npm run db:sync\` and commit the result.`,
        );
      } else {
        lock[dir] = digest;
      }
    }
  }

  if (violations.length > 0) {
    console.error("Migration integrity check failed:\n");
    for (const v of violations) console.error(`  ✗ ${v}`);
    process.exit(1);
  }

  if (checkOnly) {
    // 2b. In check mode, also assert drizzle produced nothing unsynced.
    const pending = existsSync(DRIZZLE_OUT)
      ? readdirSync(DRIZZLE_OUT).filter((f) => f.endsWith(".sql"))
      : [];
    const known = new Set(existingDirs().map((d) => d.replace(/^\d+_/, "")));
    const unsynced = pending.filter((f) => !known.has(slugOf(f)));
    if (unsynced.length > 0) {
      console.error(
        `Unsynced migrations found in ${DRIZZLE_OUT}/: ${unsynced.join(", ")}\n` +
          `Run \`npm run db:sync\` and commit the result.`,
      );
      process.exit(1);
    }
    // Counts what is actually verified, not what is on disk. The two numbers
    // were allowed to differ, and the message reported the larger one.
    console.log(`✓ ${Object.keys(lock).length} migration(s) recorded and intact.`);
    return;
  }

  // 2a. Move any new drizzle output into the Netlify layout.
  const generated = existsSync(DRIZZLE_OUT)
    ? readdirSync(DRIZZLE_OUT).filter((f) => f.endsWith(".sql")).sort()
    : [];
  const known = new Set(existingDirs().map((d) => d.replace(/^\d+_/, "")));

  let moved = 0;
  generated.forEach((file, i) => {
    const slug = slugOf(file);
    if (known.has(slug)) return;

    const dir = `${stamp(existingDirs().length + i + 1)}_${slug}`;
    const target = join(NETLIFY_MIGRATIONS, dir);
    mkdirSync(target, { recursive: true });

    const contents = readFileSync(join(DRIZZLE_OUT, file), "utf8");
    writeFileSync(join(target, "migration.sql"), contents);
    lock[dir] = sha(contents);
    moved += 1;
    console.log(`→ ${dir}/migration.sql`);
  });

  writeFileSync(LOCKFILE, `${JSON.stringify(lock, null, 2)}\n`);
  console.log(
    moved === 0
      ? "No new migrations. Lockfile up to date."
      : `Synced ${moved} migration(s). Commit them with the schema change.`,
  );
}

main();
