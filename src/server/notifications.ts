import { sql } from "drizzle-orm";

import { db } from "@/db/client";

/**
 * Draining the notification outbox.
 *
 * ── Why an outbox at all ────────────────────────────────────────────
 * The task engine writes notification rows in the SAME statement as the state
 * change. It does not send anything. That split is the whole point: sending is
 * a network call to a third party that can be slow, can fail, and can succeed
 * twice. If it happened inline, either a Resend outage would refuse a customer's
 * state change, or a state change would commit and the email would vanish.
 *
 * So the write path only ever makes a durable promise ("someone should be told
 * this"), and this module keeps it. A failure here is retried; it can never
 * unmake the task change that caused it.
 *
 * ── Delivery semantics ──────────────────────────────────────────────
 * At-least-once, not exactly-once. Exactly-once across our database and someone
 * else's API is not available at any price, so a claimed row that dies
 * mid-flight is retried and may send twice. For "your task shipped", a rare
 * duplicate is a much smaller harm than a silent miss.
 */

export interface OutboxRow extends Record<string, unknown> {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/** Give up after this many tries and stop burning quota on a dead address. */
export const MAX_ATTEMPTS = 5;

/**
 * How long a claimed row stays invisible to other workers.
 *
 * Long enough that a slow mail API call finishes inside it; short enough that a
 * worker killed mid-batch does not strand a customer's notification for an
 * hour.
 */
export const LEASE_SECONDS = 300;

/**
 * Claim a batch of pending notifications.
 *
 * ── Why a lease and not FOR UPDATE SKIP LOCKED ──────────────────────
 * SKIP LOCKED is the right pattern when claim, send and acknowledge share one
 * transaction. They cannot here — the HTTP driver has no transactions, so the
 * row lock dies with the claim statement, well before the email is sent. Two
 * workers a heartbeat apart would both claim the same row and the customer
 * would be told twice.
 *
 * So the claim writes a deadline into the row instead. That survives the
 * statement ending, the connection closing, and the worker being killed — and
 * when it expires the work is retried rather than lost.
 *
 * SKIP LOCKED is still here, doing the smaller job it is actually good for:
 * keeping two exactly-simultaneous claims from queueing behind each other.
 */
export async function claimBatch(limit = 20): Promise<OutboxRow[]> {
  const rows = await db.execute<OutboxRow>(sql`
    WITH claimed AS (
      SELECT id FROM notifications
      WHERE sent_at IS NULL
        AND failed_at IS NULL
        AND attempts < ${MAX_ATTEMPTS}
        -- Unclaimed, or claimed by a worker that never came back.
        AND (claimed_until IS NULL OR claimed_until < now())
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    ),
    bumped AS (
      UPDATE notifications SET
        attempts = notifications.attempts + 1,
        claimed_until = now() + make_interval(secs => ${LEASE_SECONDS})
      FROM claimed
      WHERE notifications.id = claimed.id
      RETURNING notifications.*
    )
    SELECT bumped.id, bumped.user_id AS "userId", bumped.type, bumped.payload,
           bumped.attempts, users.email, users.name
    FROM bumped
    JOIN users ON users.id = bumped.user_id
    ORDER BY bumped.created_at
  `);

  const result = (rows as unknown as { rows?: unknown[] }).rows ?? rows;
  return (Array.isArray(result) ? result : []) as OutboxRow[];
}

export async function markSent(id: string): Promise<void> {
  await db.execute(sql`UPDATE notifications SET sent_at = now() WHERE id = ${id}`);
}

/**
 * Record a failure.
 *
 * Only stamps `failed_at` once the retry budget is spent. Before that the row
 * stays pending so the next run picks it up — a transient 503 from the mail
 * provider should not permanently drop a customer's shipping notice.
 */
export async function markFailed(id: string, error: string): Promise<void> {
  await db.execute(sql`
    UPDATE notifications
    SET last_error = ${error.slice(0, 500)},
        failed_at = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN now() ELSE NULL END,
        -- Back off rather than retrying immediately. A provider returning 503
        -- because it is overloaded does not want the same batch again a
        -- millisecond later; that turns one outage into a retry storm that
        -- burns the attempt budget in a second and drops the message for good.
        -- Linear in attempts, so the fifth try is five minutes after the fourth.
        claimed_until = now() + make_interval(mins => attempts)
    WHERE id = ${id}
  `);
}

/**
 * Hand a row straight back, unclaimed.
 *
 * For a worker shutting down cleanly with work still in hand: better to release
 * it now than to leave a customer waiting out the full lease for a message that
 * was never going to be sent by this process.
 */
export async function releaseClaim(id: string): Promise<void> {
  await db.execute(sql`UPDATE notifications SET claimed_until = NULL WHERE id = ${id}`);
}

/** What a delivery channel has to do. Swapped for a fake in tests. */
export interface Channel {
  send(row: OutboxRow): Promise<void>;
}

export interface DrainResult {
  claimed: number;
  sent: number;
  failed: number;
}

/**
 * Process one batch.
 *
 * Sends are sequential rather than parallel on purpose: this runs behind a
 * scheduled function against a provider with a rate limit, and a burst of 20
 * concurrent calls is the fastest way to get throttled into a retry storm.
 */
export async function drainOnce(channel: Channel, limit = 20): Promise<DrainResult> {
  const batch = await claimBatch(limit);
  let sent = 0;
  let failed = 0;

  for (const row of batch) {
    try {
      await channel.send(row);
      await markSent(row.id);
      sent += 1;
    } catch (error) {
      // One bad address must not abandon the rest of the batch.
      await markFailed(row.id, error instanceof Error ? error.message : String(error));
      failed += 1;
    }
  }

  return { claimed: batch.length, sent, failed };
}

/**
 * The copy each notification carries.
 *
 * Kept here rather than in the channel so the words are the same whether they
 * arrive by email, in-app, or anywhere added later — and so they are reviewable
 * in one place. Every line is written from the customer's side, in the same
 * voice as the marketing site.
 */
export function renderNotification(row: OutboxRow): { subject: string; body: string } {
  const reference = String(row.payload["reference"] ?? "your task");
  const title = String(row.payload["title"] ?? "");

  switch (row.type) {
    case "task.in_progress":
      return {
        subject: `${reference} — we've started`,
        body: `We've picked up "${title}". You'll hear from us again when it's ready to look at.`,
      };
    case "task.shipped":
      return {
        subject: `${reference} — shipped`,
        body: `"${title}" is live. If anything about it isn't right, reply and we'll pick it straight back up.`,
      };
    case "task.cancelled":
      return {
        subject: `${reference} — cancelled`,
        body: `"${title}" has been cancelled and is off the queue.`,
      };
    default:
      return {
        subject: `${reference} — updated`,
        body: title,
      };
  }
}

/**
 * The default channel: log and mark sent.
 *
 * Resend is not wired until email is configured, and an outbox that silently
 * accumulates forever is worse than one that visibly drains. This keeps the
 * retry accounting honest in every environment, and swapping in the real
 * provider is one implementation of `Channel`.
 */
export const consoleChannel: Channel = {
  async send(row) {
    const { subject } = renderNotification(row);
    console.warn(`[notify] ${row.email} — ${subject} (no mail provider configured)`);
  },
};
