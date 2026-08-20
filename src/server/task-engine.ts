import { randomUUID } from "node:crypto";

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

import type { TaskState } from "@/components/product/status";
import { db } from "@/db/client";
import { organizations, tasks } from "@/db/schema";

import { consumeCredit, refundCredit } from "./billing/allowance";
import { available, canTransition, refusalReason } from "./queue/concurrency";
import { slaDeadline } from "./queue/sla";
import { isUniqueViolation } from "./pg-error";

/**
 * M4 — the task engine.
 *
 * ── Why this is written in SQL and not in TypeScript ────────────────
 *
 * The obvious implementation is `db.transaction(async tx => { … })`: read the
 * in-flight count, compare it to the cap, then write. That implementation
 * cannot run here, for two separate reasons.
 *
 * 1. **The driver forbids it.** §6 of the brief puts us on Netlify DB via
 *    `@netlify/neon`, which is the Neon *HTTP* driver. Drizzle's neon-http
 *    session throws `"No transactions support in neon-http driver"` — HTTP is
 *    stateless, so there is no session to hold a transaction open across
 *    round trips.
 *
 * 2. **Even with transactions it would be wrong by default.** Read-then-write
 *    under READ COMMITTED is the classic check-then-act race: two admins click
 *    "start" simultaneously, both read `inFlight = 1` against a limit of 2, and
 *    both proceed — putting the organisation at 3. That is the bug that
 *    quietly gives the product away for free, and it is the single most
 *    expensive bug this codebase could ship.
 *
 * So each mutation is **one statement**. A single statement is implicitly its
 * own transaction, so the state change, the timeline entry and the notification
 * outbox rows all land or all fail together, in one round trip.
 *
 * ── Why the cap is a unique index and not a count ───────────────────
 *
 * The first version of this file enforced the cap by counting in-flight tasks
 * in a CTE, serialised by `SELECT … FOR UPDATE` on the organisation row. It
 * looked airtight and it did not work. Integration tests against a real
 * Postgres started FIVE tasks against a limit of two.
 *
 * The reason is snapshot semantics: every CTE in a statement is evaluated
 * against one snapshot taken when the statement begins. FOR UPDATE makes the
 * waiters queue up, but a waiter granted the lock does not get a fresh snapshot
 * for the rest of its query — so it still reads the count from before it
 * waited. Every claimant sees "nothing running" and every one proceeds.
 *
 * Counting can therefore never enforce this without transactions. So the cap
 * stopped being a number we check and became a slot we take: each running task
 * holds a slot in 1..limit and a unique partial index refuses a duplicate. It
 * is no longer a rule this code has to remember — a third occupant of a
 * two-slot organisation is not something the schema can represent.
 *
 * The rules themselves still live in the pure modules under ./queue, which are
 * unit-tested without a database. This file is the transport.
 *
 * Everything here is exercised against a real Postgres in
 * tests/integration/task-engine.test.ts (`npm run test:db`). It is not enough
 * to typecheck this file — TypeScript cannot tell you that a CTE fires, that a
 * lock serialises, or that a bare boolean parameter has no inferable type.
 */

/** Thrown when a queue rule refuses an action — almost always the cap. */
export class QueueRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueueRuleError";
  }
}

export interface Capacity {
  inFlight: number;
  limit: number;
  available: number;
}

export async function inFlightCount(organizationId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        eq(tasks.organizationId, organizationId),
        inArray(tasks.state, ["in_progress", "in_review"]),
      ),
    );

  return rows[0]?.n ?? 0;
}

/** What the board shows as "2/2 running". */
export async function capacity(organizationId: string, limit: number): Promise<Capacity> {
  const inFlight = await inFlightCount(organizationId);
  return { inFlight, limit, available: available(inFlight, limit) };
}

/**
 * Queue a new task.
 *
 * ── Two limits, and only one of them applies here ────────────────────
 * Queueing spends a TASK CREDIT — the unit the customer paid for. It does not
 * touch the concurrency cap, which governs how much we deliver at once and is
 * enforced on the transition into `in_progress`.
 *
 * A customer holding 5 credits with a concurrency of 2 can submit all 5 today;
 * two of them will be worked on at a time. Conflating the two would either
 * refuse work someone has paid for or promise parallel delivery we did not sell.
 *
 * The credit is claimed BEFORE the task row is written, and deliberately so: a
 * task that exists without having been paid for is worse than a credit briefly
 * spent against no task. The former is invisible revenue loss; the latter is
 * recoverable, and the ledger row is repaired by `linkCreditToTask` a moment
 * later. `skipCredit` exists for work the team raises on a customer's behalf,
 * which must not come out of their allowance.
 */
export async function queueTask(input: {
  organizationId: string;
  actorId: string;
  title: string;
  body?: string | undefined;
  storeId?: string | undefined;
  /** Internal work raised on the customer's behalf. Does not spend a credit. */
  skipCredit?: boolean | undefined;
}): Promise<{ id: string; reference: string; position: number; creditsRemaining: number }> {
  // The SLA deadline is computed in TypeScript, not SQL: the business-hours
  // arithmetic is subtle (weekends, opening hours) and is unit-tested in
  // ./queue/sla.ts. Reimplementing it in PL/pgSQL would mean two versions of
  // a rule that must never disagree.
  //
  // That forces one extra read: the plan's SLA lives on the organisation row,
  // but the deadline has to be a literal by the time the insert runs. The read
  // is safe to do outside the atomic statement because sla_hours changes on a
  // plan change, not on a queue action — and a task queued in the same
  // millisecond as an upgrade landing on the old SLA is not a correctness bug.
  const [org] = await db
    .select({ slaHours: organizations.slaHours })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);

  if (!org) throw new QueueRuleError("That workspace no longer exists.");

  const queuedAt = new Date();
  const deadline = slaDeadline(queuedAt, org.slaHours);

  // The task's id is generated here rather than by the database default, so
  // the credit can be spent against it BEFORE the row exists. The ledger is
  // append-only, so there is no opportunity to attach the id afterwards — an
  // UPDATE against it is silently discarded by the DO INSTEAD NOTHING rule,
  // which is exactly how this was caught.
  const taskId = randomUUID();

  // Claim the credit first. Throws AllowanceError with a customer-facing
  // sentence when the pack is spent — the caller surfaces it as-is.
  const creditsRemaining = input.skipCredit
    ? -1
    : await consumeCredit({
        organizationId: input.organizationId,
        actorId: input.actorId,
        taskId,
        reason: "Task queued",
      });

  const rows = await db.execute<{ id: string; reference: string; position: number }>(sql`
    WITH org AS (
      -- FOR UPDATE serialises concurrent submissions for this organisation, so
      -- two people cannot be handed the same reference or position.
      SELECT id FROM organizations
      WHERE id = ${input.organizationId}
      FOR UPDATE
    ),
    numbering AS (
      SELECT
        (SELECT count(*) FROM tasks WHERE organization_id = ${input.organizationId}) + 1 AS seq,
        COALESCE(
          (SELECT max(position) FROM tasks
            WHERE organization_id = ${input.organizationId} AND state = 'queued'), 0
        ) + 1 AS next_position
    ),
    inserted AS (
      INSERT INTO tasks (
        id, organization_id, store_id, reference, title, body,
        state, position, created_by, queued_at, sla_deadline
      )
      SELECT
        ${taskId}::uuid,
        org.id,
        ${input.storeId ?? null}::uuid,
        -- Scoped per organisation so two customers can both hold a UNB-001
        -- without a global counter leaking how much work the business runs.
        'UNB-' || lpad(numbering.seq::text, 3, '0'),
        ${input.title},
        ${input.body ?? null},
        'queued',
        numbering.next_position,
        ${input.actorId}::uuid,
        ${queuedAt.toISOString()}::timestamptz,
        ${deadline.toISOString()}::timestamptz
      FROM org, numbering
      RETURNING id, reference, position
    ),
    logged AS (
      INSERT INTO task_events (task_id, actor_id, type, to_state)
      SELECT id, ${input.actorId}::uuid, 'queued', 'queued' FROM inserted
    )
    SELECT id, reference, position FROM inserted
  `);

  const row = (rows as unknown as { rows?: unknown[] }).rows ?? rows;
  const created = (Array.isArray(row) ? row[0] : undefined) as
    | { id: string; reference: string; position: number }
    | undefined;

  if (!created) {
    // The credit is already spent and no task exists to attach it to. Hand it
    // straight back rather than leaving the customer short for a failure that
    // was entirely ours.
    if (!input.skipCredit) {
      await refundCredit({
        organizationId: input.organizationId,
        actorId: input.actorId,
        reason: "Task creation failed after the credit was claimed",
      }).catch((error: unknown) => {
        // Log loudly: this leaves a real discrepancy a human must fix.
        console.error("[task-engine] could not return a claimed credit", error);
      });
    }
    throw new QueueRuleError("Could not queue that task.");
  }

  return { ...created, creditsRemaining };
}

/**
 * Move a task to a new state.
 *
 * Returns nothing on success. Throws `QueueRuleError` when the transition is
 * illegal or the plan's concurrency cap is already spent — the message is
 * written for the customer, not for a log.
 */
export async function transitionTask(input: {
  taskId: string;
  organizationId: string;
  actorId: string;
  next: TaskState;
}): Promise<void> {
  // Read current state first so a refusal can be explained precisely. This read
  // is NOT the capacity check — that happens inside the atomic statement below,
  // which is what actually enforces the cap.
  const [current] = await db
    .select({
      state: tasks.state,
      firstResponseAt: tasks.firstResponseAt,
    })
    .from(tasks)
    .where(and(eq(tasks.id, input.taskId), eq(tasks.organizationId, input.organizationId)))
    .limit(1);

  if (!current) throw new QueueRuleError("That task no longer exists.");

  const from = current.state as TaskState;
  const next = input.next;
  const terminal = next === "shipped" || next === "cancelled";
  const holdsSlot = next === "in_progress" || next === "in_review";
  const isFirstResponse = next === "in_progress" && current.firstResponseAt === null;

  // Legality is decided here, not in SQL, and that split is deliberate.
  //
  // Whether queued → shipped is allowed depends only on (from, next). It is a
  // pure function with no shared state, so there is nothing to race and nothing
  // SQL could tell us that TRANSITIONS in ./queue/concurrency.ts does not.
  // Capacity is the opposite — it depends on rows other requests are changing
  // underneath us — so it stays in the statement below.
  //
  // Enforcing legality here also means the refusal carries a real explanation
  // rather than the generic "changed while you were looking at it" that a
  // no-rows-matched result can only guess at.
  if (!canTransition(from, next)) {
    throw new QueueRuleError(
      refusalReason(from, next, 0, Number.MAX_SAFE_INTEGER) ??
        `A task cannot go from ${from} to ${next}.`,
    );
  }

  // Retry on a lost slot race. Each attempt is a fresh statement and therefore
  // a fresh snapshot, so a loser sees the winner's slot and picks the next free
  // one. Bounded because the only way to keep losing is real contention, and at
  // that point refusing is the honest answer.
  for (let attempt = 0; ; attempt += 1) {
    try {
      await attemptTransition({ ...input, from, terminal, holdsSlot, isFirstResponse });
      break;
    } catch (error) {
      if (isSlotConflict(error) && attempt < SLOT_RETRIES) continue;
      throw error;
    }
  }

  // Positions are compacted separately. It is not part of the atomic unit
  // because a stale position is cosmetic, whereas a lost state change is not —
  // and keeping it out keeps the critical statement small.
  if (terminal) await compactQueue(input.organizationId);
}

/** How many times a slot collision is retried before the caller is refused. */
const SLOT_RETRIES = 5;

/** Postgres unique-violation on the slot index — a lost race, not a real refusal. */
function isSlotConflict(error: unknown): boolean {
  return isUniqueViolation(error, "tasks_org_slot_key");
}

async function attemptTransition(input: {
  taskId: string;
  organizationId: string;
  actorId: string;
  next: TaskState;
  from: TaskState;
  terminal: boolean;
  holdsSlot: boolean;
  isFirstResponse: boolean;
}): Promise<void> {
  const { from, next, terminal, holdsSlot, isFirstResponse } = input;

  const rows = await db.execute<{ id: string }>(sql`
    WITH org AS (
      SELECT id, concurrency_limit FROM organizations
      WHERE id = ${input.organizationId}
    ),
    -- THE CAP.
    --
    -- The lowest slot number in 1..limit that nobody is sitting in. If the
    -- organisation is full this returns no rows, the join below matches
    -- nothing, and the task does not move. If two requests race and both pick
    -- the same number, the unique index rejects one of them outright — which is
    -- the guarantee counting could never give us.
    --
    -- A task already holding a slot keeps it: in_progress → in_review is a
    -- handoff, not a second unit of work.
    slot AS (
      SELECT CASE
        WHEN NOT ${holdsSlot}::boolean THEN NULL
        WHEN ${from}::task_state IN ('in_progress', 'in_review')
          THEN (SELECT t.slot FROM tasks t WHERE t.id = ${input.taskId})
        ELSE (
          SELECT s FROM org, generate_series(1, org.concurrency_limit) AS s
          WHERE NOT EXISTS (
            SELECT 1 FROM tasks t
            WHERE t.organization_id = ${input.organizationId}
              AND t.slot = s
              AND t.state IN ('in_progress', 'in_review')
          )
          ORDER BY s
          LIMIT 1
        )
      END AS n
    ),
    moved AS (
      UPDATE tasks SET
        state = ${next}::task_state,
        -- A task in the queue must have a position; one that has left must not.
        -- A CHECK constraint enforces this too.
        -- Every boolean parameter carries an explicit ::boolean. Without it
        -- Postgres cannot infer a type for a bare $n in a CASE/WHERE predicate
        -- and rejects the whole statement with "could not determine data type
        -- of parameter". Integration tests caught this; nothing in TypeScript
        -- could have.
        position = CASE
          WHEN ${terminal}::boolean THEN NULL
          WHEN ${next}::task_state = 'queued' THEN COALESCE(
            (SELECT max(position) FROM tasks
              WHERE organization_id = ${input.organizationId} AND state = 'queued'), 0
          ) + 1
          ELSE NULL
        END,
        -- The SLA is met at FIRST RESPONSE, when work starts — not at delivery.
        -- The site promises a response time and never a delivery time, so any
        -- other modelling would make the marketing copy false.
        first_response_at = CASE WHEN ${isFirstResponse}::boolean THEN now() ELSE first_response_at END,
        started_at        = CASE WHEN ${isFirstResponse}::boolean THEN now() ELSE started_at END,
        assigned_to       = CASE WHEN ${isFirstResponse}::boolean THEN ${input.actorId}::uuid ELSE assigned_to END,
        shipped_at        = CASE WHEN ${next === "shipped"}::boolean THEN now() ELSE shipped_at END,
        cancelled_at      = CASE WHEN ${next === "cancelled"}::boolean THEN now() ELSE cancelled_at END,
        slot              = slot.n
      FROM org, slot
      WHERE tasks.id = ${input.taskId}
        AND tasks.organization_id = org.id
        -- Optimistic guard: if someone else moved this task since we read it,
        -- no row matches and we refuse rather than clobbering their change.
        AND tasks.state = ${from}::task_state
        -- No free slot means no move. slot.n is NULL both when the
        -- organisation is full and when the target state does not need one, so
        -- the two cases are told apart by holdsSlot rather than by NULL alone.
        AND (NOT ${holdsSlot}::boolean OR slot.n IS NOT NULL)
        -- THE ESTIMATION GATE. A task held for exceeding the plan's hours
        -- ceiling cannot enter development, which is the only thing that makes
        -- the block real rather than a label on a screen. Terminal moves are
        -- still allowed: a customer must always be able to cancel a task they
        -- have decided not to pay to upgrade for.
        AND (NOT ${holdsSlot}::boolean OR tasks.blocked_at IS NULL)
      RETURNING tasks.id, tasks.reference, tasks.title
    ),
    logged AS (
      INSERT INTO task_events (task_id, actor_id, type, from_state, to_state)
      SELECT id, ${input.actorId}::uuid, 'transition', ${from}::task_state, ${next}::task_state
      FROM moved
    ),
    notified AS (
      -- Outbox rows land in the SAME statement as the state change: either both
      -- happen or neither does. A customer is never told a task shipped that
      -- then rolled back, and a shipped task never goes unannounced.
      INSERT INTO notifications (user_id, task_id, type, payload)
      SELECT m.user_id, moved.id, ${`task.${next}`}::text,
             jsonb_build_object('reference', moved.reference, 'title', moved.title, 'state', ${next}::text)
      FROM moved
      JOIN memberships m ON m.organization_id = ${input.organizationId}
      -- Never notify the person who caused the event; they just did it.
      WHERE m.user_id <> ${input.actorId}::uuid
        AND ${next === "in_progress" || next === "shipped"}::boolean
    )
    SELECT id FROM moved
  `);

  const result = (rows as unknown as { rows?: unknown[] }).rows ?? rows;
  const moved = Array.isArray(result) ? result.length > 0 : false;

  if (!moved) {
    // No row matched. Work out why, so the customer gets a sentence they can
    // act on rather than "forbidden".
    // Work out WHY nothing matched. A blocked task and a full plan both stop
    // the same statement, and telling a customer "you're at 2 of 2" when the
    // real problem is an oversized task sends them to the wrong answer.
    const [held] = await db
      .select({ blockedReason: tasks.blockedReason })
      .from(tasks)
      .where(and(eq(tasks.id, input.taskId), isNotNull(tasks.blockedAt)))
      .limit(1);

    if (held?.blockedReason) throw new QueueRuleError(held.blockedReason);

    const inFlight = await inFlightCount(input.organizationId);
    const [org] = await db
      .select({ limit: organizations.concurrencyLimit })
      .from(organizations)
      .where(eq(organizations.id, input.organizationId))
      .limit(1);

    throw new QueueRuleError(
      refusalReason(from, next, inFlight, org?.limit ?? 1) ??
        "That task changed while you were looking at it. Reload and try again.",
    );
  }
}

/**
 * Close the gaps after a task leaves the queue so positions stay 1..n.
 *
 * A customer told "you are 4th" when only two tasks are ahead stops believing
 * every other number we show them — and queue position is the transparency
 * pillar's most visible claim.
 *
 * One statement, so it cannot half-apply.
 */
export async function compactQueue(organizationId: string): Promise<void> {
  await db.execute(sql`
    WITH ranked AS (
      SELECT id, row_number() OVER (ORDER BY position, created_at) AS rn
      FROM tasks
      WHERE organization_id = ${organizationId} AND state = 'queued'
    )
    UPDATE tasks SET position = ranked.rn
    FROM ranked
    WHERE tasks.id = ranked.id AND tasks.position IS DISTINCT FROM ranked.rn
  `);
}
