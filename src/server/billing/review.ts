import { sql } from "drizzle-orm";

import { db } from "@/db/client";

import { checkEstimate, resolvePolicy, smallestPlanCovering } from "./estimation";

/**
 * The review step — where a task is sized and either cleared or held.
 *
 * This runs BEFORE development starts, which is the whole point. An estimate
 * produced after two days of work is not a gate, it is an argument.
 */

export class ReviewError extends Error {
  constructor(
    message: string,
    readonly publicMessage: string,
  ) {
    super(message);
    this.name = "ReviewError";
  }
}

export interface ReviewOutcome {
  taskId: string;
  reference: string;
  estimatedHours: number;
  allowed: boolean;
  /** Present when held. Written for the customer. */
  blockedReason?: string;
  /** The cheapest plan that would cover it, when one exists. */
  suggestedPlan?: { code: string; name: string; priceCents: number; maxTaskHours: number | null };
}

/**
 * Record an estimate and apply the ceiling.
 *
 * One statement for the write, so a task can never be marked estimated without
 * its block decision landing at the same time — a task showing an estimate but
 * no block would read as cleared for work it is not cleared for.
 */
export async function estimateTask(input: {
  taskId: string;
  actorId: string;
  hours: number;
}): Promise<ReviewOutcome> {
  if (!Number.isFinite(input.hours) || input.hours < 0) {
    throw new ReviewError("Estimate must be a non-negative number.", "Enter the estimate in hours.");
  }

  // Resolve the ceiling that applies to this customer: their override if they
  // have one, otherwise their plan's.
  const context = await db.execute<{
    task_id: string;
    reference: string;
    organization_id: string;
    state: string;
    customer_max: string | null;
    plan_max: string | null;
  }>(sql`
    SELECT t.id AS task_id, t.reference, t.organization_id, t.state::text AS state,
           o.max_task_hours AS customer_max,
           p.max_task_hours AS plan_max
    FROM tasks t
    JOIN organizations o ON o.id = t.organization_id
    LEFT JOIN plans p ON p.id = o.current_plan_id
    WHERE t.id = ${input.taskId}
  `);

  const row = first<{
    task_id: string;
    reference: string;
    organization_id: string;
    state: string;
    customer_max: string | null;
    plan_max: string | null;
  }>(context);

  if (!row) throw new ReviewError("No such task.", "That task no longer exists.");

  // Estimating work that is already delivered has no meaning, and would let a
  // block be applied to something the customer has already received.
  if (row.state === "shipped" || row.state === "cancelled") {
    throw new ReviewError(
      `Task ${row.reference} is ${row.state}.`,
      "That task is already closed.",
    );
  }

  const policy = resolvePolicy({
    customerMaxHours: row.customer_max === null ? null : Number(row.customer_max),
    planMaxHours: row.plan_max === null ? null : Number(row.plan_max),
  });

  const verdict = checkEstimate(input.hours, policy);
  const blocked = !verdict.allowed;

  await db.execute(sql`
    WITH updated AS (
      UPDATE tasks SET
        estimated_hours = ${input.hours},
        estimated_by = ${input.actorId}::uuid,
        estimated_at = now(),
        blocked_reason = ${blocked ? verdict.reason : null},
        -- Re-estimating downwards clears an earlier block. A task held at 12
        -- hours and re-scoped to 6 must become workable again without anyone
        -- remembering to unblock it by hand.
        blocked_at = CASE WHEN ${blocked}::boolean THEN now() ELSE NULL END
      WHERE id = ${input.taskId}
      RETURNING id
    )
    INSERT INTO task_events (task_id, actor_id, type)
    SELECT id, ${input.actorId}::uuid, ${blocked ? "blocked" : "estimated"}
    FROM updated
  `);

  if (!blocked) {
    return {
      taskId: row.task_id,
      reference: row.reference,
      estimatedHours: input.hours,
      allowed: true,
    };
  }

  // Name the plan that would cover it. "Upgrade" without saying to what leaves
  // the customer to work it out, which is how a blocked task becomes a
  // support ticket instead of a sale.
  const plans = await db.execute<{
    code: string;
    name: string;
    price_cents: number;
    max_task_hours: string | null;
  }>(sql`
    SELECT code, name, price_cents, max_task_hours
    FROM plans WHERE is_active ORDER BY price_cents
  `);

  const list = ((plans as unknown as { rows?: unknown[] }).rows ?? plans) as {
    code: string;
    name: string;
    price_cents: number;
    max_task_hours: string | null;
  }[];

  const suggestion = smallestPlanCovering(
    input.hours,
    (Array.isArray(list) ? list : []).map((p) => ({
      code: p.code,
      name: p.name,
      priceCents: Number(p.price_cents),
      maxTaskHours: p.max_task_hours === null ? null : Number(p.max_task_hours),
    })),
  );

  return {
    taskId: row.task_id,
    reference: row.reference,
    estimatedHours: input.hours,
    allowed: false,
    blockedReason: verdict.reason,
    ...(suggestion ? { suggestedPlan: suggestion } : {}),
  };
}

/**
 * Lift a block by hand.
 *
 * Someone senior decides to absorb an oversized task — a goodwill call, or a
 * deal closed verbally. It has to be possible, and it has to leave a record of
 * who decided it.
 */
export async function clearBlock(input: {
  taskId: string;
  actorId: string;
  reason: string;
}): Promise<boolean> {
  const rows = await db.execute<{ id: string }>(sql`
    WITH cleared AS (
      UPDATE tasks SET blocked_at = NULL, blocked_reason = NULL
      WHERE id = ${input.taskId} AND blocked_at IS NOT NULL
      RETURNING id
    ),
    logged AS (
      INSERT INTO task_events (task_id, actor_id, type)
      SELECT id, ${input.actorId}::uuid, 'unblocked' FROM cleared
    )
    SELECT id FROM cleared
  `);

  const result = (rows as unknown as { rows?: unknown[] }).rows ?? rows;
  return Array.isArray(result) && result.length > 0;
}

function first<T>(rows: unknown): T | undefined {
  const result = (rows as { rows?: unknown[] }).rows ?? rows;
  return (Array.isArray(result) ? (result[0] as T | undefined) : undefined) ?? undefined;
}
