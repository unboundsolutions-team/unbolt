import { existsSync, readFileSync } from "node:fs";

/**
 * Load `.env.local` the way Next.js does, for scripts that Next does not run.
 *
 * ── Why this is needed ──────────────────────────────────────────────
 * `next dev` and `next build` read `.env.local` themselves, so anything running
 * inside Next sees those values. Nothing else does. A script invoked as
 * `node scripts/migrate.mjs` or through tsx gets the bare process environment,
 * finds no database URL, and reports that none is configured — while the dev
 * server two terminals over is connected and working from the same file.
 *
 * That is a genuinely confusing failure: the message is accurate, the file
 * exists, and the two facts look contradictory.
 *
 * ── Precedence ──────────────────────────────────────────────────────
 * A variable already present in the environment always wins. On Netlify there
 * is no `.env.local` and `NETLIFY_DATABASE_URL` is injected by the platform; a
 * file must never be able to override that, and an explicit value passed on the
 * command line must never be silently replaced by a stale one on disk.
 *
 * No dependency on dotenv. This runs before anything else and in the deploy's
 * build step, so it should need nothing installed beyond node itself.
 */
export function loadEnvFiles(files = [".env.local", ".env"]) {
  const loaded = [];

  for (const file of files) {
    if (!existsSync(file)) continue;

    for (const line of readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;

      const key = trimmed.slice(0, eq).trim();
      // Quotes are stripped because people copy values out of dashboards that
      // wrap them, and a connection string with a trailing quote fails with a
      // DNS error naming a host that has one in it.
      const value = trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");

      if (process.env[key] === undefined) process.env[key] = value;
    }
    loaded.push(file);
  }

  return loaded;
}
