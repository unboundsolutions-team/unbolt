import type { TaskState } from "@/components/product/status";

/**
 * "Unlimited queue, limited concurrency" — the pricing model, as code.
 *
 * Pure by design: no database, no clock, no request. Everything it needs is
 * passed in, so the rule that decides whether a customer gets what they paid
 * for can be exhaustively tested. The Drizzle orchestration lives in
 * src/server/task-engine.ts and calls into this.
 *
 * This is the authoritative TypeScript copy of app/Services/Queue/
 * ConcurrencyPolicy.php in the Laravel API. Both are property-tested against
 * the same assertions so they cannot drift.
 */

/**
 * Does a task in this state occupy one of the plan's concurrency slots?
 *
 * The single most commercially important predicate in the codebase. If it
 * counted queued tasks, every customer would sit permanently at their limit.
 * If it excluded in-review, a plan could run unbounded work by parking
 * everything in review.
 */
export function occupiesSlot(state: TaskState): boolean {
  return state === "in_progress" || state === "in_review";
}

export function isTerminal(state: TaskState): boolean {
  return state === "shipped" || state === "cancelled";
}

/**
 * Legal transitions. Anything not listed is refused.
 *
 * `in_review → in_progress` exists because review can send work back; without
 * it a failed review would have to be cancelled and re-queued, losing the
 * task's history and its original SLA.
 */
const TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  queued: ["in_progress", "cancelled"],
  in_progress: ["in_review", "shipped", "queued", "cancelled"],
  in_review: ["shipped", "in_progress", "cancelled"],
  shipped: [],
  cancelled: [],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedNext(from: TaskState): readonly TaskState[] {
  return TRANSITIONS[from];
}

/** Can a task move into `next` right now, given the org's current load? */
export function permits(
  current: TaskState,
  next: TaskState,
  inFlight: number,
  limit: number,
): boolean {
  if (!canTransition(current, next)) return false;

  // Freeing or holding a slot is always allowed. A customer must never be
  // blocked from cancelling work or shipping what is already running, even if
  // their plan was downgraded underneath them.
  if (!occupiesSlot(next)) return true;

  // Already holding a slot and staying in one (in_progress → in_review) does
  // not consume a second.
  if (occupiesSlot(current)) return true;

  return inFlight < limit;
}

/**
 * Why a transition was refused, for the UI.
 *
 * Returning a reason rather than a bare false is what lets the portal say
 * "you're at 2 of 2 — ship or cancel something first" instead of "forbidden".
 */
export function refusalReason(
  current: TaskState,
  next: TaskState,
  inFlight: number,
  limit: number,
): string | null {
  if (!canTransition(current, next)) {
    return `A task cannot move from ${current.replace("_", " ")} to ${next.replace("_", " ")}.`;
  }
  if (permits(current, next, inFlight, limit)) return null;

  return (
    `This plan runs ${limit} task${limit === 1 ? "" : "s"} at a time and ` +
    `${inFlight} ${inFlight === 1 ? "is" : "are"} already running. ` +
    `Ship or cancel something first, or move up a plan.`
  );
}

/** Slots left. Never negative, even if a plan was downgraded mid-flight. */
export function available(inFlight: number, limit: number): number {
  return Math.max(0, limit - inFlight);
}
