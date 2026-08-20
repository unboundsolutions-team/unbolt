/**
 * Find the Postgres error inside whatever the driver threw.
 *
 * ── Why this is not just `error.code` ───────────────────────────────
 * Three places in this codebase turn a unique-violation into ordinary
 * behaviour rather than a 500:
 *
 *   organizations_slug_key   → append a suffix and try again
 *   stores_active_domain_key → "another workspace has that store connected"
 *   tasks_org_slot_key       → a lost race for a concurrency slot; retry
 *
 * All three read `error.code` off the thrown object. That worked until
 * drizzle-orm started wrapping driver errors in a DrizzleQueryError, at which
 * point `code` moved to `error.cause` and all three predicates silently began
 * returning false.
 *
 * The failure mode is not an exception somewhere obvious. It is a customer
 * seeing "something went wrong" when they pick a workspace name someone else
 * has, and — worse, because it is invisible — the task engine giving up on a
 * slot collision instead of retrying it, which turns a routine lost race under
 * concurrency into a refused transition.
 *
 * So the shape is read defensively, through the cause chain, once.
 */

export interface PgError {
  code?: string;
  constraint?: string;
  detail?: string;
  table?: string;
}

/**
 * Walk `cause` until something looks like a Postgres error.
 *
 * Bounded, because a cause chain can be circular and a hang here would be a
 * very confusing bug to find.
 */
export function pgError(error: unknown): PgError | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const candidate = current as PgError & { cause?: unknown };
    if (typeof candidate.code === "string") return candidate;
    current = candidate.cause;
  }
  return null;
}

/** A unique-violation on a specific constraint, whatever wrapped it. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const pg = pgError(error);
  return pg?.code === "23505" && pg.constraint === constraint;
}
