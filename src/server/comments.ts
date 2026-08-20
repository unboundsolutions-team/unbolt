import { sql } from "drizzle-orm";

import { db } from "@/db/client";

/**
 * Task comments — the clarification loop.
 *
 * Without this, every "which page exactly?" and "can you confirm the copy?"
 * happens in email, and the task timeline lies by omission: it shows a task
 * sitting in review for three days with no visible reason.
 *
 * ── Internal notes ──────────────────────────────────────────────────
 * One thread, with a visibility flag, rather than two threads. A separate
 * internal system means the team keeps a second, invisible history and the
 * customer-facing one rots. The flag is enforced on read, in SQL, so an
 * internal note cannot reach a customer through a forgotten filter.
 */

export class CommentError extends Error {
  constructor(
    message: string,
    readonly publicMessage: string,
  ) {
    super(message);
    this.name = "CommentError";
  }
}

export const MAX_COMMENT_LENGTH = 5000;

export interface Comment {
  id: string;
  body: string;
  isInternal: boolean;
  authorName: string | null;
  authorIsInternal: boolean;
  createdAt: string;
  editedAt: string | null;
}

/**
 * Post a comment.
 *
 * The task is looked up scoped to the organisation in the same statement that
 * inserts, so a comment cannot be attached to another tenant's task by passing
 * its id — there is no window between checking and writing.
 *
 * `isInternal` is only honoured for staff. A customer cannot post a hidden
 * comment on their own task, which would be a confusing thing to allow and a
 * trivial thing to forget to prevent.
 */
export async function postComment(input: {
  taskId: string;
  organizationId: string;
  authorId: string;
  body: string;
  isInternal?: boolean | undefined;
  authorIsInternal: boolean;
}): Promise<{ id: string }> {
  const body = input.body.trim();
  if (body.length === 0) {
    throw new CommentError("Empty comment.", "Write something first.");
  }
  if (body.length > MAX_COMMENT_LENGTH) {
    throw new CommentError(
      `Comment of ${body.length} characters.`,
      `That's longer than ${MAX_COMMENT_LENGTH} characters — try trimming it.`,
    );
  }

  const internal = Boolean(input.isInternal) && input.authorIsInternal;

  const rows = await db.execute<{ id: string }>(sql`
    WITH task AS (
      SELECT id FROM tasks
      WHERE id = ${input.taskId} AND organization_id = ${input.organizationId}
    ),
    posted AS (
      INSERT INTO task_comments (task_id, author_id, body, is_internal)
      SELECT task.id, ${input.authorId}::uuid, ${body}, ${internal}::boolean
      FROM task
      RETURNING id, task_id
    ),
    logged AS (
      -- Comments belong on the timeline. A task whose history shows a state
      -- change but not the conversation that caused it is a misleading record.
      INSERT INTO task_events (task_id, actor_id, type)
      SELECT task_id, ${input.authorId}::uuid,
             ${internal ? "internal_note" : "comment"}
      FROM posted
    )
    SELECT id FROM posted
  `);

  const created = first<{ id: string }>(rows);
  if (!created) {
    throw new CommentError(
      `Task ${input.taskId} not found in organisation ${input.organizationId}.`,
      "That task no longer exists.",
    );
  }
  return created;
}

/**
 * Read the thread.
 *
 * `includeInternal` defaults to false. The safe value is the default, so a new
 * call site that forgets to think about visibility gets the customer-safe
 * answer rather than leaking staff notes.
 */
export async function commentsFor(input: {
  taskId: string;
  organizationId: string;
  includeInternal?: boolean | undefined;
}): Promise<Comment[]> {
  const includeInternal = input.includeInternal ?? false;

  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT c.id, c.body, c.is_internal, c.created_at, c.edited_at,
           u.name AS author_name, COALESCE(u.is_internal, false) AS author_is_internal
    FROM task_comments c
    JOIN tasks t ON t.id = c.task_id
    LEFT JOIN users u ON u.id = c.author_id
    WHERE c.task_id = ${input.taskId}
      -- Tenant scoping in the WHERE clause, not in a check afterwards.
      AND t.organization_id = ${input.organizationId}
      AND (${includeInternal}::boolean OR NOT c.is_internal)
    ORDER BY c.created_at
  `);

  const result = (rows as unknown as { rows?: unknown[] }).rows ?? rows;
  const list = Array.isArray(result) ? (result as Record<string, unknown>[]) : [];

  return list.map((row) => ({
    id: String(row["id"]),
    body: String(row["body"]),
    isInternal: Boolean(row["is_internal"]),
    authorName: row["author_name"] ? String(row["author_name"]) : null,
    authorIsInternal: Boolean(row["author_is_internal"]),
    createdAt: toIso(row["created_at"]),
    editedAt: row["edited_at"] ? toIso(row["edited_at"]) : null,
  }));
}

function first<T>(rows: unknown): T | undefined {
  const result = (rows as { rows?: unknown[] }).rows ?? rows;
  return (Array.isArray(result) ? (result[0] as T | undefined) : undefined) ?? undefined;
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
