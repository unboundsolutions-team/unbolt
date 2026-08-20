import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

/**
 * Integration tests run against a REAL Postgres, not a mock.
 *
 * They are a separate config because they are a separate promise: the unit
 * suite must stay runnable with no services, so CI and `npm test` never depend
 * on a database being up. This suite is opt-in via `npm run test:db` and skips
 * itself entirely when TEST_DATABASE_URL is unset.
 *
 * Why bother: the task engine is one hand-written SQL statement per mutation.
 * Nothing in TypeScript can tell me whether a data-modifying CTE fires, whether
 * FOR UPDATE actually serialises, or whether a CHECK constraint rejects a state
 * I thought was legal. Only Postgres can answer that.
 */
export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, "./src") } },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // Each file owns its own rows but shares one database; running files in
    // parallel would make the concurrency assertions read each other's tasks.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
