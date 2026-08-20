import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "@/db/schema";

/**
 * A real database handle for integration tests.
 *
 * Production runs the Neon HTTP driver, which cannot be pointed at a local
 * Postgres. node-postgres can. The swap is safe for what these tests are
 * checking because the engine issues raw `sql` template statements through
 * `db.execute` — the SQL text sent to the server is byte-identical. What
 * differs is only the transport, and the transport is exactly what these tests
 * do NOT assert about.
 *
 * (The one place the drivers diverge in the result shape — neon-http returns an
 * array, node-postgres returns `{ rows }` — is already normalised in
 * task-engine.ts, and these tests exercise that normalisation for real.)
 */
export const CONNECTION = process.env["TEST_DATABASE_URL"];

export const pool = new pg.Pool({ connectionString: CONNECTION ?? "postgres://invalid" });
export const testDb = drizzle(pool, { schema, casing: "snake_case" });

export interface Fixture {
  orgId: string;
  ownerId: string;
  memberId: string;
}

/**
 * Wipe and rebuild the world.
 *
 * TRUNCATE … CASCADE rather than dropping the schema: it keeps the migrations
 * as the single definition of the tables, so a test can never silently pass
 * against a shape that migration.sql does not actually produce.
 */
export async function reset(options?: {
  concurrencyLimit?: number;
  slaHours?: number;
  /**
   * Task credits to start with.
   *
   * Generous by default: most suites are testing the queue, the concurrency cap
   * or notifications, and having every one of them fail on an empty allowance
   * would say nothing about the thing under test. The allowance suite sets its
   * own balance explicitly.
   */
  credits?: number;
  maxTaskHours?: number | null;
}): Promise<Fixture> {
  // plans is NOT truncated: it is seeded by the migration and is reference
  // data, not fixture data. Wiping it would leave every purchase test with no
  // plan to buy.
  //
  // It IS reset to its seeded values, though. Plans are editable from /admin,
  // and the browser suite edits them — without this, running the e2e flow first
  // silently changes what the allowance tests are asserting against. A test
  // that passes or fails depending on what ran before it is worse than no test.
  await pool.query(`
    UPDATE plans SET task_allowance = v.tasks, concurrency_limit = v.concurrency,
                     max_task_hours = v.hours, sla_hours = v.sla,
                     price_cents = v.price, is_active = true
    FROM (VALUES
      ('standard', 5, 1, 8::numeric, 48, 49900),
      ('professional', 10, 2, 16::numeric, 24, 79900),
      ('enterprise', 20, 4, 40::numeric, 8, 149900)
    ) AS v(code, tasks, concurrency, hours, sla, price)
    WHERE plans.code = v.code
  `);

  await pool.query("TRUNCATE users, organizations RESTART IDENTITY CASCADE");

  const owner = await pool.query<{ id: string }>(
    `INSERT INTO users (email, name, email_verified) VALUES ('owner@test.dev','Owner',true) RETURNING id`,
  );
  const member = await pool.query<{ id: string }>(
    `INSERT INTO users (email, name, email_verified) VALUES ('member@test.dev','Member',true) RETURNING id`,
  );
  const ownerId = owner.rows[0]!.id;
  const memberId = member.rows[0]!.id;

  const org = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug, concurrency_limit, sla_hours,
                                credits_remaining, credits_granted_total, max_task_hours)
     VALUES ('Test Co','test-co',$1,$2,$3,$3,$4) RETURNING id`,
    [
      options?.concurrencyLimit ?? 2,
      options?.slaHours ?? 48,
      options?.credits ?? 500,
      options?.maxTaskHours ?? null,
    ],
  );
  const orgId = org.rows[0]!.id;

  await pool.query(
    `INSERT INTO memberships (organization_id, user_id, role) VALUES ($1,$2,'owner'), ($1,$3,'member')`,
    [orgId, ownerId, memberId],
  );

  return { orgId, ownerId, memberId };
}

export async function countTasks(orgId: string, state: string): Promise<number> {
  const r = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM tasks WHERE organization_id = $1 AND state = $2`,
    [orgId, state],
  );
  return Number(r.rows[0]!.n);
}
