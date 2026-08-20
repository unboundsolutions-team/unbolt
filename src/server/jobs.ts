import { sql } from "drizzle-orm";

import { db } from "@/db/client";

/**
 * Durable background work.
 *
 * §2.1 of the addendum: a scan takes ~30s and a synchronous Netlify function
 * times out at ~10s, so the work must be handed off. Attempt count and last
 * error live in Postgres rather than in a queue service — the trade the
 * addendum made deliberately to avoid a fourth SaaS bill.
 *
 * Claimed by LEASE, not by row lock, for the reason M4 learned the hard way:
 * the HTTP driver has no transactions, so a lock dies with the claim statement
 * and cannot protect work that outlives it. See netlify/database/migrations/
 * 20260818000005_notification_lease for the full explanation.
 */

export const LEASE_SECONDS = 900; // matches the 15-minute background function ceiling

export interface Job<T = Record<string, unknown>> extends Record<string, unknown> {
  id: string;
  kind: string;
  payload: T;
  attempts: number;
  maxAttempts: number;
}

export async function enqueue(input: {
  kind: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
  runAfter?: Date;
}): Promise<string> {
  const rows = await db.execute<{ id: string }>(sql`
    INSERT INTO jobs (kind, payload, max_attempts, run_after)
    VALUES (
      ${input.kind},
      ${JSON.stringify(input.payload)}::jsonb,
      ${input.maxAttempts ?? 3},
      ${(input.runAfter ?? new Date()).toISOString()}::timestamptz
    )
    RETURNING id
  `);

  const result = (rows as unknown as { rows?: unknown[] }).rows ?? rows;
  const created = (Array.isArray(result) ? result[0] : undefined) as { id: string } | undefined;
  if (!created) throw new Error("Job insert returned no row.");
  return created.id;
}

/**
 * Claim the next ready jobs of a kind.
 *
 * A job is ready when it is unfinished, has attempts left, its `run_after` has
 * passed, and no live lease covers it. The lease and the attempt increment land
 * in the same statement, so a worker that dies immediately after claiming still
 * leaves a consistent count and its lease still expires.
 */
export async function claimJobs<T = Record<string, unknown>>(
  kind: string,
  limit = 1,
): Promise<Job<T>[]> {
  const rows = await db.execute<Job<T>>(sql`
    WITH ready AS (
      SELECT id FROM jobs
      WHERE kind = ${kind}
        AND completed_at IS NULL
        AND failed_at IS NULL
        AND attempts < max_attempts
        AND run_after <= now()
        AND (claimed_until IS NULL OR claimed_until < now())
      ORDER BY run_after, created_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    ),
    claimed AS (
      UPDATE jobs SET
        attempts = jobs.attempts + 1,
        claimed_until = now() + make_interval(secs => ${LEASE_SECONDS})
      FROM ready
      WHERE jobs.id = ready.id
      RETURNING jobs.id, jobs.kind, jobs.payload, jobs.attempts, jobs.max_attempts
    )
    SELECT id, kind, payload, attempts, max_attempts AS "maxAttempts" FROM claimed
  `);

  const result = (rows as unknown as { rows?: unknown[] }).rows ?? rows;
  return (Array.isArray(result) ? result : []) as Job<T>[];
}

export async function completeJob(id: string): Promise<void> {
  await db.execute(sql`
    UPDATE jobs SET completed_at = now(), claimed_until = NULL, last_error = NULL
    WHERE id = ${id}
  `);
}

/**
 * Record a failure.
 *
 * `failed_at` is only stamped once the attempt budget is spent — before that
 * the job stays claimable so a transient problem is retried. The retry backs
 * off, because retrying a timed-out fetch instantly just times out again and
 * burns the budget in seconds.
 */
export async function failJob(id: string, error: string): Promise<void> {
  await db.execute(sql`
    UPDATE jobs SET
      last_error = ${error.slice(0, 1000)},
      claimed_until = NULL,
      run_after = now() + make_interval(secs => 30 * attempts),
      failed_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END
    WHERE id = ${id}
  `);
}

/** True once a job has spent its budget — the caller decides what to tell the user. */
export function isTerminal(job: Job): boolean {
  return job.attempts >= job.maxAttempts;
}
