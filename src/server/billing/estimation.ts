/**
 * Effort estimation and the plan ceiling.
 *
 * ── The rule this encodes ───────────────────────────────────────────
 * A task credit is not the only gate. Holding a credit means a customer may
 * *submit*; it does not mean any task of any size is covered. The team
 * estimates effort on review, and a task estimated above the customer's ceiling
 * stops there until they move up a plan.
 *
 * The point is to catch this BEFORE development starts. An estimate that lands
 * after an engineer has spent two days is not a gate, it is an invoice dispute.
 *
 * Pure — no I/O — so every branch is testable without a database, and so the
 * same rule can be evaluated on a form as it will be on the server.
 */

/** Resolved for one organisation: plan default, overridden per customer. */
export interface EstimationPolicy {
  /** Hours. NULL / undefined means no ceiling — the plan covers any size. */
  maxTaskHours: number | null;
  /** Where the ceiling came from, for explaining it. */
  source: "plan" | "customer" | "none";
}

export type EstimateVerdict =
  | { allowed: true }
  | { allowed: false; reason: string; overBy: number };

/**
 * Resolve the ceiling that actually applies.
 *
 * A per-customer value wins over the plan's, including when it is *lower* — a
 * negotiated deal can be tighter as well as looser, and silently taking the
 * larger of the two would hand out capacity nobody agreed to.
 */
export function resolvePolicy(input: {
  planMaxHours?: number | null | undefined;
  customerMaxHours?: number | null | undefined;
}): EstimationPolicy {
  if (input.customerMaxHours !== null && input.customerMaxHours !== undefined) {
    return { maxTaskHours: input.customerMaxHours, source: "customer" };
  }
  if (input.planMaxHours !== null && input.planMaxHours !== undefined) {
    return { maxTaskHours: input.planMaxHours, source: "plan" };
  }
  return { maxTaskHours: null, source: "none" };
}

/**
 * Does this estimate fit?
 *
 * Equal to the ceiling is allowed. A plan advertised as "up to 8 hours" that
 * rejects an 8-hour task is a plan that lies by one hour, and that argument is
 * not worth having with a customer.
 */
export function checkEstimate(
  estimatedHours: number,
  policy: EstimationPolicy,
): EstimateVerdict {
  if (!Number.isFinite(estimatedHours) || estimatedHours < 0) {
    return { allowed: false, reason: "That estimate isn't a number of hours.", overBy: 0 };
  }
  if (policy.maxTaskHours === null) return { allowed: true };
  if (estimatedHours <= policy.maxTaskHours) return { allowed: true };

  const overBy = round2(estimatedHours - policy.maxTaskHours);
  return {
    allowed: false,
    reason: blockedReason(estimatedHours, policy.maxTaskHours),
    overBy,
  };
}

/**
 * What the customer reads when their task is held.
 *
 * Written to be actionable and non-accusatory: it is not their fault the task
 * is large, and the sentence has to survive being screenshotted into a
 * complaint. It states the measurement, the limit, and the one thing that
 * changes the outcome.
 */
export function blockedReason(estimatedHours: number, ceiling: number): string {
  return (
    `We estimate this at ${fmtHours(estimatedHours)}, which is over the ` +
    `${fmtHours(ceiling)} covered by your current plan. Move up a plan and we'll ` +
    `start straight away — nothing is lost, and the task stays exactly as you wrote it.`
  );
}

/**
 * The cheapest plan that would cover this task.
 *
 * Returned so the block can name a specific next step rather than telling
 * someone to "upgrade" and leaving them to work out to what. Plans with no
 * ceiling cover everything and sort last, so the smallest sufficient plan wins.
 */
export function smallestPlanCovering<T extends { maxTaskHours: number | null; priceCents: number }>(
  estimatedHours: number,
  plans: readonly T[],
): T | null {
  const covering = plans.filter(
    (p) => p.maxTaskHours === null || estimatedHours <= p.maxTaskHours,
  );
  if (covering.length === 0) return null;

  return (
    [...covering].sort((a, b) => a.priceCents - b.priceCents)[0] ?? null
  );
}

/** "6 hours", "1 hour", "1.5 hours" — never "6.00". */
export function fmtHours(hours: number): string {
  const rounded = round2(hours);
  const label = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  return `${label} ${rounded === 1 ? "hour" : "hours"}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
