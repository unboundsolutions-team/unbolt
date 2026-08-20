import { neon } from "@netlify/neon";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";
import { pgError } from "@/server/pg-error";

/**
 * Netlify DB (Neon) over HTTP.
 *
 * The connection string is injected by Netlify per deploy context — production
 * gets the production branch, every deploy preview gets its own isolated branch
 * seeded from production. It is never managed by hand and never read from a
 * committed file.
 *
 * ── Why this is lazy ──────────────────────────────────────────────
 * Resolving the connection at module scope means importing this file throws
 * when the env var is absent. That turns a missing variable into a *build*
 * failure on Netlify — including the very first deploy, before the database
 * extension has provisioned anything — even for pages that never run a query.
 *
 * Deferring to first use means the build always succeeds, and a genuinely
 * missing variable fails at query time with a message that says what to do.
 * The client is still memoised, so it is reused across warm invocations rather
 * than reconstructed per request.
 */
let cached: ReturnType<typeof create> | null = null;

/**
 * The Netlify DB client, and the type every other path must satisfy.
 *
 * Named separately so the local fallback below can be annotated against it —
 * inferring both from one function makes the return type reference itself.
 */
function createNeon(connectionString: string) {
  return drizzle(neon(connectionString), { schema, casing: "snake_case" });
}

/** The one shape the rest of the app codes against, whatever the transport. */
export type Db = ReturnType<typeof createNeon>;

function create(): Db {
  const connectionString = process.env["NETLIFY_DATABASE_URL"];
  if (connectionString) return createNeon(connectionString);

  // ── Local development escape hatch ────────────────────────────────
  //
  // Neon's HTTP driver cannot talk to a Postgres on localhost, so without this
  // the portal is unrunnable with `npm run dev` — you need a provisioned
  // Netlify DB before you can look at a page. That is a bad first hour for
  // anyone joining, and it makes the app impossible to test against a throwaway
  // database.
  //
  // DEVELOPMENT_DATABASE_URL is a plain postgres:// URL and is honoured ONLY
  // outside production. The check is on NODE_ENV rather than a custom variable
  // because NODE_ENV is set by `next build`/`next start` and cannot be
  // forgotten — a production deploy physically cannot take this branch, so a
  // stray variable in the Netlify UI cannot point live traffic at a dev box.
  const local = process.env["DEVELOPMENT_DATABASE_URL"];
  if (local && process.env.NODE_ENV !== "production") {
    return createLocal(local);
  }

  /*
   * The message is long on purpose.
   *
   * This is the first error anyone hits on a fresh checkout, and the earlier
   * version of it named two variables without saying where either comes from.
   * Somebody reading it after cloning the repo has no way to know that the
   * value lives in the Netlify UI, or that a plain postgres:// URL will not
   * work in the first variable. Both mistakes look like the app being broken.
   */
  throw new Error(
    "No database configured.\n\n" +
      "Set ONE of these in a .env.local file at the repository root:\n\n" +
      "  NETLIFY_DATABASE_URL=postgresql://…\n" +
      "      The Neon URL from Netlify: your project → Database → the connection\n" +
      "      string. Netlify injects this automatically on a deploy; locally you\n" +
      "      either paste it here or run `netlify link && netlify dev`, which\n" +
      "      links it for you.\n\n" +
      "  DEVELOPMENT_DATABASE_URL=postgres://user@localhost:5432/unbolt_dev\n" +
      "      A local Postgres. Honoured ONLY outside production, so it can never\n" +
      "      point live traffic at a dev box. Use this if you would rather not\n" +
      "      develop against the real database.\n\n" +
      "See LOCAL-DEV.md. Note the two are not interchangeable: the first goes\n" +
      "through Neon's HTTP driver and cannot reach a Postgres on localhost.",
  );
}

/**
 * node-postgres against a local database.
 *
 * `require` rather than a top-level import, so the driver stays out of the
 * production module graph entirely — this branch is unreachable there, and a
 * static import would pull `pg` into every serverless bundle to sit unused.
 *
 * Verified to load correctly under both runtimes that matter: Next's bundler
 * and plain tsx (`npm run scan:worker`).
 */
function createLocal(connectionString: string): Db {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle: pgDrizzle } = require("drizzle-orm/node-postgres") as {
    drizzle: (url: string, config: unknown) => Db;
  };
  console.warn("[db] Using DEVELOPMENT_DATABASE_URL — local Postgres, not Netlify DB.");
  return pgDrizzle(connectionString, { schema, casing: "snake_case" });
}

/**
 * Put the reason back into a failed query.
 *
 * ── What this fixes ─────────────────────────────────────────────────
 * A failing `db.execute` surfaces as:
 *
 *     Failed query:
 *       SELECT * FROM plans
 *       WHERE is_public AND is_active
 *     params:
 *
 * — and nothing else. The actual reason ("relation "plans" does not exist",
 * "password authentication failed", "connection refused") is on `error.cause`,
 * where the Next error overlay does not show it and nobody thinks to look.
 *
 * Every one of those causes needs a completely different fix, and the message
 * distinguishes none of them. This lifts the underlying Postgres error into the
 * message, keeps the original on `cause` so isUniqueViolation() still walks the
 * chain, and adds the one line of advice that the two most common causes share.
 */
function explain(error: unknown): unknown {
  const pg = pgError(error);
  if (!pg?.message && !pg?.code) return error;

  /*
   * Matched on the message as well as the code.
   *
   * Neon's HTTP driver returns `code: ''` for connection-level failures — the
   * SQLSTATE is only populated once a session exists, and authentication fails
   * before that. So a wrong password arrives with an empty code and a perfectly
   * clear message, and a hint keyed only on the code says nothing.
   *
   * This exact case cost an afternoon: the migration runner connected fine
   * because the password was passed on the command line, while the app read a
   * .env.local that still had a placeholder in it. Two different credentials,
   * one of them wrong, and nothing pointing at the file.
   */
  const text = pg.message ?? "";
  const hint =
    pg.code === "42P01" || /relation .* does not exist/i.test(text)
      ? "\n\nThe table does not exist — the schema has not been applied to this " +
        "database. Run `npm run db:migrate`."
      : pg.code === "28P01" ||
          pg.code === "28000" ||
          /password authentication failed|role .* does not exist/i.test(text)
        ? "\n\nThe credentials are wrong. Check the password in NETLIFY_DATABASE_URL " +
          "in .env.local — note that this is a DIFFERENT place from any --url you " +
          "passed on the command line, so migrations can succeed while the app " +
          "cannot connect."
        : /ENOTFOUND|ECONNREFUSED|fetch failed/i.test(text)
          ? "\n\nCould not reach the database host. Check the hostname in " +
            "NETLIFY_DATABASE_URL, and that the value has no stray quotes around it."
          : "";

  return new Error(
    `Database query failed: ${pg.message ?? "unknown error"}` +
      (pg.code ? ` [${pg.code}]` : "") +
      (pg.detail ? `\n${pg.detail}` : "") +
      hint,
    { cause: error },
  );
}

/**
 * Proxy so `db.select(...)` reads naturally at call sites while the underlying
 * client is only constructed on the first property access.
 */
export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    cached ??= create();
    const value = Reflect.get(cached, prop, receiver) as unknown;

    // `execute` is every raw-SQL call in this codebase, which is every write
    // path and most reads. Wrapping it is where the whole benefit is.
    if (prop === "execute" && typeof value === "function") {
      return (...args: unknown[]) => {
        try {
          return Promise.resolve(
            (value as (...a: unknown[]) => unknown).apply(cached, args),
          ).catch((error: unknown) => {
            throw explain(error);
          });
        } catch (error) {
          throw explain(error);
        }
      };
    }

    return value;
  },
});

export { schema };
