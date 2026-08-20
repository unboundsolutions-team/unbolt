import type { Config } from "drizzle-kit";

/**
 * Generation only. Migrations are applied by scripts/migrate.ts, wired into
 * the Netlify build command — we never
 * push from a developer machine. `npm run db:generate && npm run db:sync`.
 */
export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  strict: true,
  verbose: true,
} satisfies Config;
