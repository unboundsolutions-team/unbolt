import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import type { Task } from "@/components/product/task-card";
import { BOARD_STATES, type TaskState } from "@/components/product/status";
import { db } from "@/db/client";
import { organizations, stores, tasks, taskEvents, users } from "@/db/schema";

/**
 * Reads for the portal.
 *
 * Kept apart from task-engine.ts on purpose: that file is the write path, where
 * every statement is load-bearing for correctness and changes need integration
 * tests. This one is projection — safe to extend, and it never mutates.
 *
 * Every function takes an organisation id that the CALLER has already proven
 * the viewer belongs to, via getAuthContext. Nothing here re-checks it, so
 * nothing here may be called with an id that came off a request.
 */

export interface BoardData {
  tasks: Task[];
  inFlight: number;
  concurrencyLimit: number;
  slaHours: number;
}

/**
 * Everything the board needs, in two queries rather than one per column.
 *
 * Terminal work is capped rather than unbounded: a customer two years in has
 * hundreds of shipped tasks and no interest in scrolling them on the overview.
 */
export async function boardFor(
  organizationId: string,
  options?: { shippedLimit?: number },
): Promise<BoardData> {
  const shippedLimit = options?.shippedLimit ?? 8;

  const [org] = await db
    .select({
      concurrencyLimit: organizations.concurrencyLimit,
      slaHours: organizations.slaHours,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);

  const rows = await db
    .select({
      id: tasks.id,
      reference: tasks.reference,
      title: tasks.title,
      state: tasks.state,
      position: tasks.position,
      slaDeadline: tasks.slaDeadline,
      shippedAt: tasks.shippedAt,
      // Stores are identified by domain — that is what the customer recognises
      // on a card, and there is no separate display name to drift from it.
      store: stores.domain,
    })
    .from(tasks)
    .leftJoin(stores, eq(stores.id, tasks.storeId))
    .where(
      and(
        eq(tasks.organizationId, organizationId),
        inArray(tasks.state, [...BOARD_STATES]),
      ),
    )
    // Queue order first, then most-recent activity. `position` is NULL for
    // anything that has left the queue, so NULLS LAST keeps running work from
    // being sorted above the queue it came from.
    //
    // Written as raw SQL rather than asc(sql`… NULLS LAST`): the helper appends
    // its own direction keyword, producing `position NULLS LAST asc`, which
    // Postgres rejects outright. The direction has to come before NULLS.
    .orderBy(sql`${tasks.position} ASC NULLS LAST`, desc(tasks.updatedAt));

  const shipped = rows.filter((r) => r.state === "shipped");
  const keep = new Set(shipped.slice(0, shippedLimit).map((r) => r.id));

  const projected = rows
    .filter((r) => r.state !== "shipped" || keep.has(r.id))
    .map(toCardTask);

  return {
    tasks: projected,
    inFlight: rows.filter((r) => r.state === "in_progress" || r.state === "in_review").length,
    concurrencyLimit: org?.concurrencyLimit ?? 1,
    slaHours: org?.slaHours ?? 48,
  };
}

/**
 * Database row → the shape the board component already speaks.
 *
 * `exactOptionalPropertyTypes` is on, so an absent value has to be an absent
 * key rather than an explicit undefined — hence the spread guards.
 */
function toCardTask(row: {
  id: string;
  reference: string;
  title: string;
  state: string;
  slaDeadline: Date | null;
  shippedAt: Date | null;
  store: string | null;
}): Task {
  return {
    id: row.id,
    ref: row.reference,
    title: row.title,
    state: row.state as TaskState,
    ...(row.store ? { store: row.store } : {}),
    // A deadline on finished work would render a counting-down clock on a task
    // nobody is waiting for.
    ...(row.slaDeadline && row.state !== "shipped"
      ? { slaDeadline: row.slaDeadline.toISOString() }
      : {}),
    ...(row.shippedAt ? { shippedAt: relativeDay(row.shippedAt) } : {}),
  };
}

/** "2d ago" — short enough for the card footer, honest about precision. */
function relativeDay(at: Date): string {
  const days = Math.floor((Date.now() - at.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return at.toISOString().slice(0, 10);
}

export interface TaskDetail extends Task {
  body: string | null;
  position: number | null;
  estimatedHours: number | null;
  blockedReason: string | null;
  blockedAt: string | null;
  timeline: {
    id: string;
    type: string;
    fromState: string | null;
    toState: string | null;
    actor: string | null;
    at: string;
  }[];
}

/**
 * One task with its full history.
 *
 * The organisation id is in the WHERE clause, not just checked afterwards: a
 * task id from another tenant returns nothing rather than returning a row we
 * then have to remember to reject.
 */
export async function taskDetail(
  organizationId: string,
  taskId: string,
): Promise<TaskDetail | null> {
  const [row] = await db
    .select({
      id: tasks.id,
      reference: tasks.reference,
      title: tasks.title,
      body: tasks.body,
      state: tasks.state,
      position: tasks.position,
      slaDeadline: tasks.slaDeadline,
      shippedAt: tasks.shippedAt,
      estimatedHours: tasks.estimatedHours,
      blockedReason: tasks.blockedReason,
      blockedAt: tasks.blockedAt,
      // Stores are identified by domain — that is what the customer recognises
      // on a card, and there is no separate display name to drift from it.
      store: stores.domain,
    })
    .from(tasks)
    .leftJoin(stores, eq(stores.id, tasks.storeId))
    .where(and(eq(tasks.id, taskId), eq(tasks.organizationId, organizationId)))
    .limit(1);

  if (!row) return null;

  const events = await db
    .select({
      id: taskEvents.id,
      type: taskEvents.type,
      fromState: taskEvents.fromState,
      toState: taskEvents.toState,
      actor: users.name,
      at: taskEvents.createdAt,
    })
    .from(taskEvents)
    .leftJoin(users, eq(users.id, taskEvents.actorId))
    .where(eq(taskEvents.taskId, taskId))
    .orderBy(asc(taskEvents.createdAt));

  return {
    ...toCardTask(row),
    body: row.body,
    position: row.position,
    estimatedHours: row.estimatedHours === null ? null : Number(row.estimatedHours),
    blockedReason: row.blockedReason,
    blockedAt: row.blockedAt ? row.blockedAt.toISOString() : null,
    timeline: events.map((e) => ({
      id: e.id,
      type: e.type,
      fromState: e.fromState,
      toState: e.toState,
      actor: e.actor,
      at: e.at.toISOString(),
    })),
  };
}
