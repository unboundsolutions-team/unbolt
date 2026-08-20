import { sql } from "drizzle-orm";

import { db } from "@/db/client";

/**
 * Who owns a task.
 *
 * ── Why this needed to exist ────────────────────────────────────────
 * `tasks.assigned_to` has been on the table since M4, but nothing set it
 * deliberately — it was a side effect of the first transition into in_progress,
 * and no screen read it. So the team worked from one undifferentiated list with
 * no way to answer "what is mine" or "who is overloaded", which is the first
 * question anyone asks on a shared queue.
 *
 * Assignment is deliberately NOT required to start work. An engineer picking up
 * an unassigned task still claims it, because a process that makes you assign
 * before you can begin is a process people route around.
 */

export class AssignmentError extends Error {
  constructor(
    message: string,
    readonly publicMessage: string,
  ) {
    super(message);
    this.name = "AssignmentError";
  }
}

/**
 * Assign, reassign, or hand back.
 *
 * `assigneeId: null` unassigns. One statement, with the timeline entry, so a
 * task cannot change hands without the history showing it — "who was working on
 * this in March" is a question that gets asked.
 */
export async function assignTask(input: {
  taskId: string;
  assigneeId: string | null;
  actorId: string;
}): Promise<{ reference: string }> {
  const rows = await db.execute<{ reference: string }>(sql`
    WITH assignee AS (
      -- Only internal staff can own a task. A customer id arriving here would
      -- otherwise put a task in the workload of someone who cannot see /admin.
      SELECT id FROM users
      WHERE id = ${input.assigneeId}::uuid AND is_internal
    ),
    moved AS (
      UPDATE tasks SET assigned_to = ${input.assigneeId}::uuid
      WHERE id = ${input.taskId}
        AND state NOT IN ('shipped', 'cancelled')
        -- Either we are clearing the owner, or the new owner is real staff.
        AND (${input.assigneeId === null}::boolean OR EXISTS (SELECT 1 FROM assignee))
      RETURNING id, reference
    ),
    logged AS (
      INSERT INTO task_events (task_id, actor_id, type)
      SELECT id, ${input.actorId}::uuid,
             ${input.assigneeId === null ? "unassigned" : "assigned"}
      FROM moved
    )
    SELECT reference FROM moved
  `);

  const row = first<{ reference: string }>(rows);
  if (!row) {
    throw new AssignmentError(
      `Could not assign task ${input.taskId} to ${input.assigneeId ?? "nobody"}.`,
      "That task is closed, or that person isn't on the team.",
    );
  }
  return row;
}

export interface EngineerWorkload {
  userId: string;
  name: string | null;
  email: string;
  internalRole: string | null;
  /** Open tasks assigned to them, in any non-terminal state. */
  open: number;
  /** Of those, how many are actually being worked on right now. */
  inFlight: number;
  /** Sum of estimates on their open work. Null estimates count as zero. */
  estimatedHours: number;
  /** Their nearest SLA deadline, so "who is about to breach" is visible. */
  nextDeadline: string | null;
}

/**
 * Workload across the team.
 *
 * Includes staff with nothing assigned — the whole point is seeing who is free,
 * and a list that silently omits idle people answers the opposite question.
 */
export async function teamWorkload(): Promise<EngineerWorkload[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT u.id, u.name, u.email, u.internal_role::text AS internal_role,
           count(t.id) FILTER (WHERE t.id IS NOT NULL)::int AS open,
           count(t.id) FILTER (WHERE t.state IN ('in_progress','in_review'))::int AS in_flight,
           COALESCE(sum(t.estimated_hours), 0)::float AS estimated_hours,
           min(t.sla_deadline) AS next_deadline
    FROM users u
    LEFT JOIN tasks t
      ON t.assigned_to = u.id AND t.state NOT IN ('shipped','cancelled')
    WHERE u.is_internal
    GROUP BY u.id, u.name, u.email, u.internal_role
    ORDER BY count(t.id) DESC, u.email
  `);

  return list(rows).map((row) => ({
    userId: String(row["id"]),
    name: row["name"] ? String(row["name"]) : null,
    email: String(row["email"]),
    internalRole: row["internal_role"] ? String(row["internal_role"]) : null,
    open: Number(row["open"] ?? 0),
    inFlight: Number(row["in_flight"] ?? 0),
    estimatedHours: Number(row["estimated_hours"] ?? 0),
    nextDeadline: row["next_deadline"] ? iso(row["next_deadline"]) : null,
  }));
}

/** How much work has no owner at all. The number that should stay near zero. */
export async function unassignedCount(): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM tasks
    WHERE assigned_to IS NULL AND state NOT IN ('shipped','cancelled')
  `);
  return Number(first<{ n: number }>(rows)?.n ?? 0);
}

/** Staff who can be assigned work. */
export async function assignableStaff(): Promise<
  { id: string; name: string | null; email: string }[]
> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT id, name, email FROM users WHERE is_internal ORDER BY name NULLS LAST, email
  `);
  return list(rows).map((row) => ({
    id: String(row["id"]),
    name: row["name"] ? String(row["name"]) : null,
    email: String(row["email"]),
  }));
}

function list(rows: unknown): Record<string, unknown>[] {
  const result = (rows as { rows?: unknown[] }).rows ?? rows;
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

function first<T>(rows: unknown): T | undefined {
  const result = (rows as { rows?: unknown[] }).rows ?? rows;
  return (Array.isArray(result) ? (result[0] as T | undefined) : undefined) ?? undefined;
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
