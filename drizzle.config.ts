import type { Config } from "drizzle-kit";

/**
 * Generation only. Netlify applies migrations on deploy; scripts/migrate.mjs
 * applies them locally. We never
 * push from a developer machine. `npm run db:generate && npm run db:sync`.
 */
export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  strict: true,
  verbose: true,
} satisfies Config;
