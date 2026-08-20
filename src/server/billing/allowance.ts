import { sql } from "drizzle-orm";

import { db } from "@/db/client";

/**
 * Task credits — the thing the customer actually bought.
 *
 * ── Why the balance is a counter and not a SUM over the ledger ───────
 * The ledger is the honest record, so the obvious design is
 * `SELECT sum(delta) … ` and compare. That is read-then-write, and M4 proved
 * exactly what happens to read-then-write here: the HTTP driver has no
 * transactions, every CTE in a statement shares one snapshot, and two
 * simultaneous requests both read the pre-spend balance and both proceed.
 *
 * For the concurrency cap that meant delivering unpaid work. Here it means
 * giving away a task credit — the unit the customer is billed for.
 *
 * So the balance lives in a counter column and is spent with
 *
 *     UPDATE organizations SET credits_remaining = credits_remaining - 1
 *     WHERE id = $1 AND credits_remaining > 0
 *
 * which is safe for a reason worth stating precisely: when an UPDATE finds a
 * row another transaction has concurrently modified, Postgres re-fetches the
 * new version and **re-evaluates the WHERE clause against it**. The balance
 * check therefore runs against the fresh value, not the snapshot. This is the
 * same reason `UPDATE accounts SET balance = balance - 100 WHERE balance >= 100`
 * is the canonical safe withdrawal, and it is why counting failed where this
 * does not.
 *
 * The ledger is written in the SAME statement, so a spend can never happen
 * without its audit row, and a CHECK constraint keeps the counter from ever
 * going negative even if this file is wrong.
 */

export class AllowanceError extends Error {
  constructor(
    message: string,
    readonly publicMessage: string,
  ) {
    super(message);
    this.name = "AllowanceError";
  }
}

export interface Balance {
  remaining: number;
  grantedTotal: number;
  usedTotal: number;
  /**
   * The plan this workspace is on, if any.
   *
   * Carried on the balance because the one screen that needs it is the one
   * shown when the balance hits zero — "buy another <plan name> pack" needs the
   * name, and buying needs the code.
   */
  planCode: string | null;
  planName: string | null;
}

export async function balanceFor(organizationId: string): Promise<Balance> {
  const rows = await db.execute<{
    remaining: number;
    granted: number;
    used: number;
    plan_code: string | null;
    plan_name: string | null;
  }>(sql`
    SELECT o.credits_remaining AS remaining,
           o.credits_granted_total AS granted,
           o.credits_used_total AS used,
           -- Only a plan that can still be bought. Offering to repurchase one
           -- that has been retired sends the customer to a checkout for
           -- something we no longer sell.
           --
           -- CASE, not FILTER: FILTER only attaches to aggregates, and this is
           -- a plain column reference.
           CASE WHEN p.is_active AND p.is_public THEN p.code END AS plan_code,
           CASE WHEN p.is_active AND p.is_public THEN p.name END AS plan_name
    FROM organizations o
    LEFT JOIN plans p ON p.id = o.current_plan_id
    WHERE o.id = ${organizationId}
  `);

  const row = first<{
    remaining: number;
    granted: number;
    used: number;
    plan_code: string | null;
    plan_name: string | null;
  }>(rows);
  if (!row) throw new AllowanceError("No such organisation.", "That workspace no longer exists.");

  return {
    remaining: Number(row.remaining),
    grantedTotal: Number(row.granted),
    usedTotal: Number(row.used),
    planCode: row.plan_code,
    planName: row.plan_name,
  };
}

/**
 * Spend one credit, or refuse.
 *
 * Returns the balance remaining AFTER the spend so a caller can tell the
 * customer "4 left" without a second read that might already be stale.
 *
 * The caller passes the task id it is ABOUT to insert, generated client-side.
 * That ordering matters: the credit must be claimed before the task exists, or
 * a task can exist unpaid — but the ledger is append-only, so there is no
 * second chance to attach the id afterwards. Generating the uuid up front gets
 * both: the spend is recorded against the right task, in one write, before the
 * task row is created.
 */
export async function consumeCredit(input: {
  organizationId: string;
  actorId: string;
  taskId?: string | undefined;
  reason?: string | undefined;
}): Promise<number> {
  const rows = await db.execute<{ remaining: number }>(sql`
    WITH spent AS (
      UPDATE organizations SET
        credits_remaining = credits_remaining - 1,
        credits_used_total = credits_used_total + 1
      WHERE id = ${input.organizationId}
        -- THE CHECK. Re-evaluated against the freshly-locked row, which is what
        -- makes this safe against a concurrent spend.
        AND credits_remaining > 0
      RETURNING id, credits_remaining
    ),
    logged AS (
      INSERT INTO credit_ledger (
        organization_id, type, delta, balance_after, task_id, actor_id, reason
      )
      SELECT id, 'consume', -1, credits_remaining,
             ${input.taskId ?? null}::uuid, ${input.actorId}::uuid,
             ${input.reason ?? null}
      FROM spent
    )
    SELECT credits_remaining AS remaining FROM spent
  `);

  const row = first<{ remaining: number }>(rows);
  if (!row) {
    throw new AllowanceError(
      `Organisation ${input.organizationId} has no credits left.`,
      "You've used all the tasks in your plan. Buy another pack or move up a plan to keep going.",
    );
  }
  return Number(row.remaining);
}

/**
 * Hand a credit back.
 *
 * Cancelling a task the team never started should not cost the customer a
 * credit — charging for work nobody did is the fastest way to lose one. This is
 * deliberately NOT automatic on every cancellation: work that was started and
 * then abandoned by the customer has consumed real time.
 */
export async function refundCredit(input: {
  organizationId: string;
  actorId: string;
  taskId?: string | undefined;
  reason: string;
}): Promise<number> {
  const rows = await db.execute<{ remaining: number }>(sql`
    WITH given AS (
      UPDATE organizations SET
        credits_remaining = credits_remaining + 1,
        -- used_total goes back down too, or the "5 of 5 used" a customer sees
        -- drifts away from what they were actually charged for.
        credits_used_total = greatest(credits_used_total - 1, 0)
      WHERE id = ${input.organizationId}
      RETURNING id, credits_remaining
    ),
    logged AS (
      INSERT INTO credit_ledger (
        organization_id, type, delta, balance_after, task_id, actor_id, reason
      )
      SELECT id, 'refund', 1, credits_remaining,
             ${input.taskId ?? null}::uuid, ${input.actorId}::uuid, ${input.reason}
      FROM given
    )
    SELECT credits_remaining AS remaining FROM given
  `);

  const row = first<{ remaining: number }>(rows);
  if (!row) throw new AllowanceError("No such organisation.", "That workspace no longer exists.");
  return Number(row.remaining);
}

/**
 * Grant credits from a paid purchase, and apply the plan's terms.
 *
 * One statement, so a customer can never end up with a purchase recorded and no
 * credits, or credits with no purchase behind them.
 *
 * The organisation's operating limits are refreshed from the plan at the same
 * time — this IS the moment a plan takes effect. Per-customer overrides are
 * applied afterwards by an admin, deliberately: a purchase resets to plan
 * terms, and a negotiated exception is then re-applied explicitly rather than
 * surviving invisibly across a plan change.
 */
export async function grantFromPurchase(input: {
  purchaseId: string;
  actorId?: string | undefined;
}): Promise<{ organizationId: string; granted: number; remaining: number }> {
  const rows = await db.execute<{
    organization_id: string;
    granted: number;
    remaining: number;
  }>(sql`
    WITH purchase AS (
      SELECT p.id, p.organization_id, p.plan_id, p.tasks_granted,
             COALESCE(p.concurrency_at_purchase, pl.concurrency_limit) AS concurrency_limit,
             COALESCE(p.max_task_hours_at_purchase, pl.max_task_hours) AS max_task_hours,
             COALESCE(p.sla_hours_at_purchase, pl.sla_hours) AS sla_hours
      FROM plan_purchases p
      JOIN plans pl ON pl.id = p.plan_id
      WHERE p.id = ${input.purchaseId}
        AND p.status = 'paid'
        -- Idempotency. A purchase whose grant already landed has a ledger row;
        -- a webhook redelivery or a double-click must not grant twice.
        AND NOT EXISTS (
          SELECT 1 FROM credit_ledger l
          WHERE l.purchase_id = p.id AND l.type = 'grant'
        )
    ),
    credited AS (
      UPDATE organizations o SET
        credits_remaining = o.credits_remaining + purchase.tasks_granted,
        credits_granted_total = o.credits_granted_total + purchase.tasks_granted,
        current_plan_id = purchase.plan_id,
        concurrency_limit = purchase.concurrency_limit,
        max_task_hours = purchase.max_task_hours,
        sla_hours = purchase.sla_hours,
        -- A paid pack makes an account active again after a lapse.
        status = 'active'
      FROM purchase
      WHERE o.id = purchase.organization_id
      RETURNING o.id AS organization_id, o.credits_remaining, purchase.tasks_granted, purchase.id AS purchase_id
    ),
    logged AS (
      INSERT INTO credit_ledger (
        organization_id, type, delta, balance_after, purchase_id, actor_id, reason
      )
      SELECT organization_id, 'grant', tasks_granted, credits_remaining,
             purchase_id, ${input.actorId ?? null}::uuid, 'Pack purchased'
      FROM credited
    )
    SELECT organization_id, tasks_granted AS granted, credits_remaining AS remaining
    FROM credited
  `);

  const row = first<{ organization_id: string; granted: number; remaining: number }>(rows);
  if (!row) {
    // Either the purchase is not paid, or it was already granted. Both are
    // "nothing to do" rather than failures — the second is the whole point of
    // the idempotency guard above.
    throw new AllowanceError(
      `Purchase ${input.purchaseId} is not payable or was already granted.`,
      "That payment has already been applied.",
    );
  }

  return {
    organizationId: row.organization_id,
    granted: Number(row.granted),
    remaining: Number(row.remaining),
  };
}

/**
 * A manual correction by an admin.
 *
 * Goodwill credits, a miscount, a migration from the old model. Requires a
 * reason because an unexplained balance change is indistinguishable from a bug
 * when someone looks at it six months later.
 */
export async function adjustCredits(input: {
  organizationId: string;
  actorId: string;
  delta: number;
  reason: string;
}): Promise<number> {
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new AllowanceError("Adjustment must be a non-zero integer.", "Enter a whole number.");
  }
  if (input.reason.trim().length < 3) {
    throw new AllowanceError("Adjustment requires a reason.", "Say why you're adjusting this.");
  }

  const rows = await db.execute<{ remaining: number }>(sql`
    WITH adjusted AS (
      UPDATE organizations SET
        credits_remaining = credits_remaining + ${input.delta},
        credits_granted_total = credits_granted_total
          + greatest(${input.delta}, 0)
      WHERE id = ${input.organizationId}
        -- Never below zero. The CHECK constraint would reject it anyway; this
        -- turns a constraint violation into a sentence.
        AND credits_remaining + ${input.delta} >= 0
      RETURNING id, credits_remaining
    ),
    logged AS (
      INSERT INTO credit_ledger (
        organization_id, type, delta, balance_after, actor_id, reason
      )
      SELECT id, 'adjust', ${input.delta}, credits_remaining,
             ${input.actorId}::uuid, ${input.reason}
      FROM adjusted
    )
    SELECT credits_remaining AS remaining FROM adjusted
  `);

  const row = first<{ remaining: number }>(rows);
  if (!row) {
    throw new AllowanceError(
      "Adjustment would take the balance below zero.",
      "That would take them below zero credits.",
    );
  }
  return Number(row.remaining);
}

export interface LedgerEntry {
  id: string;
  type: string;
  delta: number;
  balanceAfter: number;
  reason: string | null;
  taskReference: string | null;
  actorName: string | null;
  createdAt: string;
}

/** The history a customer or admin reads to understand a balance. */
export async function ledgerFor(
  organizationId: string,
  limit = 50,
): Promise<LedgerEntry[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT l.id, l.type, l.delta, l.balance_after, l.reason, l.created_at,
           t.reference AS task_reference, u.name AS actor_name
    FROM credit_ledger l
    LEFT JOIN tasks t ON t.id = l.task_id
    LEFT JOIN users u ON u.id = l.actor_id
    WHERE l.organization_id = ${organizationId}
    ORDER BY l.created_at DESC
    LIMIT ${limit}
  `);

  const result = (rows as unknown as { rows?: unknown[] }).rows ?? rows;
  const list = Array.isArray(result) ? (result as Record<string, unknown>[]) : [];

  return list.map((row) => ({
    id: String(row["id"]),
    type: String(row["type"]),
    delta: Number(row["delta"]),
    balanceAfter: Number(row["balance_after"]),
    reason: row["reason"] ? String(row["reason"]) : null,
    taskReference: row["task_reference"] ? String(row["task_reference"]) : null,
    actorName: row["actor_name"] ? String(row["actor_name"]) : null,
    createdAt:
      row["created_at"] instanceof Date
        ? row["created_at"].toISOString()
        : String(row["created_at"]),
  }));
}

/** Normalises the two result shapes the drivers return. */
function first<T>(rows: unknown): T | undefined {
  const result = (rows as { rows?: unknown[] }).rows ?? rows;
  return (Array.isArray(result) ? (result[0] as T | undefined) : undefined) ?? undefined;
}
