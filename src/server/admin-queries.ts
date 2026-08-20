import { sql } from "drizzle-orm";

import { db } from "@/db/client";

/**
 * Reads for /admin.
 *
 * Separate from the customer-facing query modules because the scoping rule is
 * inverted: those must never see outside one organisation, these must see
 * across all of them. Keeping them apart means a tenant-scoped query cannot be
 * "reused" here by dropping its WHERE clause, which is how a customer page ends
 * up showing somebody else's data.
 *
 * Every function here is already behind `requireInternal` at the layout level
 * and again in each action.
 */

export interface AdminTask {
  id: string;
  reference: string;
  title: string;
  body: string | null;
  state: string;
  organizationId: string;
  organizationName: string;
  estimatedHours: number | null;
  blockedAt: string | null;
  blockedReason: string | null;
  maxTaskHours: number | null;
  slaDeadline: string | null;
  createdAt: string;
  commentCount: number;
  assignedTo: string | null;
  assigneeName: string | null;
}

/**
 * The review queue.
 *
 * Unestimated work first, because that is the step that gates everything else —
 * a task nobody has sized cannot start, and the customer is watching an SLA
 * clock run down while it sits there.
 */
export async function reviewQueue(
  limit = 100,
  filter?: { assignedTo?: string; unassignedOnly?: boolean },
): Promise<AdminTask[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT t.id, t.reference, t.title, t.body, t.state::text AS state,
           t.organization_id, o.name AS organization_name,
           t.estimated_hours, t.blocked_at, t.blocked_reason,
           COALESCE(o.max_task_hours, p.max_task_hours) AS max_task_hours,
           t.sla_deadline, t.created_at, t.assigned_to,
           a.name AS assignee_name,
           (SELECT count(*) FROM task_comments c WHERE c.task_id = t.id) AS comment_count
    FROM tasks t
    JOIN organizations o ON o.id = t.organization_id
    LEFT JOIN plans p ON p.id = o.current_plan_id
    LEFT JOIN users a ON a.id = t.assigned_to
    WHERE t.state <> 'cancelled'
      -- Both filters are applied in SQL rather than by filtering the result in
      -- TypeScript, so "my work" stays one page of rows even once the queue is
      -- long enough that LIMIT would otherwise cut off the tail.
      AND (${filter?.assignedTo ?? null}::uuid IS NULL OR t.assigned_to = ${filter?.assignedTo ?? null}::uuid)
      AND (NOT ${filter?.unassignedOnly ?? false}::boolean OR t.assigned_to IS NULL)
    ORDER BY
      -- Needs an estimate before anything can happen to it.
      (t.estimated_hours IS NULL AND t.state = 'queued') DESC,
      t.blocked_at IS NOT NULL DESC,
      t.sla_deadline NULLS LAST,
      t.created_at
    LIMIT ${limit}
  `);

  return list(rows).map((row) => ({
    id: String(row["id"]),
    reference: String(row["reference"]),
    title: String(row["title"]),
    body: row["body"] ? String(row["body"]) : null,
    state: String(row["state"]),
    organizationId: String(row["organization_id"]),
    organizationName: String(row["organization_name"]),
    estimatedHours: numeric(row["estimated_hours"]),
    blockedAt: iso(row["blocked_at"]),
    blockedReason: row["blocked_reason"] ? String(row["blocked_reason"]) : null,
    maxTaskHours: numeric(row["max_task_hours"]),
    slaDeadline: iso(row["sla_deadline"]),
    createdAt: iso(row["created_at"]) ?? "",
    commentCount: Number(row["comment_count"] ?? 0),
    assignedTo: row["assigned_to"] ? String(row["assigned_to"]) : null,
    assigneeName: row["assignee_name"] ? String(row["assignee_name"]) : null,
  }));
}

export interface AdminCustomer {
  id: string;
  name: string;
  slug: string;
  status: string;
  planName: string | null;
  creditsRemaining: number;
  creditsUsedTotal: number;
  creditsGrantedTotal: number;
  concurrencyLimit: number;
  slaHours: number;
  maxTaskHours: number | null;
  ownerEmail: string | null;
  openTasks: number;
  pendingPurchases: number;
  createdAt: string;
}

export async function customers(): Promise<AdminCustomer[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT o.id, o.name, o.slug, o.status::text AS status,
           p.name AS plan_name,
           o.credits_remaining, o.credits_used_total, o.credits_granted_total,
           o.concurrency_limit, o.sla_hours, o.max_task_hours, o.created_at,
           (SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
             WHERE m.organization_id = o.id AND m.role = 'owner'
             ORDER BY m.joined_at LIMIT 1) AS owner_email,
           (SELECT count(*) FROM tasks t
             WHERE t.organization_id = o.id
               AND t.state NOT IN ('shipped','cancelled')) AS open_tasks,
           (SELECT count(*) FROM plan_purchases pp
             WHERE pp.organization_id = o.id AND pp.status = 'pending') AS pending_purchases
    FROM organizations o
    LEFT JOIN plans p ON p.id = o.current_plan_id
    ORDER BY o.created_at DESC
  `);

  return list(rows).map((row) => ({
    id: String(row["id"]),
    name: String(row["name"]),
    slug: String(row["slug"]),
    status: String(row["status"]),
    planName: row["plan_name"] ? String(row["plan_name"]) : null,
    creditsRemaining: Number(row["credits_remaining"]),
    creditsUsedTotal: Number(row["credits_used_total"]),
    creditsGrantedTotal: Number(row["credits_granted_total"]),
    concurrencyLimit: Number(row["concurrency_limit"]),
    slaHours: Number(row["sla_hours"]),
    maxTaskHours: numeric(row["max_task_hours"]),
    ownerEmail: row["owner_email"] ? String(row["owner_email"]) : null,
    openTasks: Number(row["open_tasks"] ?? 0),
    pendingPurchases: Number(row["pending_purchases"] ?? 0),
    createdAt: iso(row["created_at"]) ?? "",
  }));
}

export interface AdminPurchase {
  id: string;
  organizationId: string;
  organizationName: string;
  planName: string;
  status: string;
  tasksGranted: number;
  priceCentsPaid: number;
  currency: string;
  createdAt: string;
}

/** Purchases awaiting payment — the list someone chases. */
export async function pendingPurchases(): Promise<AdminPurchase[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT pp.id, pp.organization_id, o.name AS organization_name, pl.name AS plan_name,
           pp.status::text AS status, pp.tasks_granted, pp.price_cents_paid,
           pp.currency, pp.created_at
    FROM plan_purchases pp
    JOIN organizations o ON o.id = pp.organization_id
    JOIN plans pl ON pl.id = pp.plan_id
    WHERE pp.status = 'pending'
    ORDER BY pp.created_at
  `);

  return list(rows).map((row) => ({
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    organizationName: String(row["organization_name"]),
    planName: String(row["plan_name"]),
    status: String(row["status"]),
    tasksGranted: Number(row["tasks_granted"]),
    priceCentsPaid: Number(row["price_cents_paid"]),
    currency: String(row["currency"]),
    createdAt: iso(row["created_at"]) ?? "",
  }));
}

export interface AdminLead {
  id: string;
  name: string;
  email: string;
  company: string | null;
  storeUrl: string | null;
  planName: string | null;
  wantsDemo: boolean;
  message: string | null;
  stage: string;
  createdAt: string;
  convertedOrganizationId: string | null;
}

export async function leads(): Promise<AdminLead[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT l.id, l.name, l.email, l.company, l.store_url, l.wants_demo, l.message,
           l.stage::text AS stage, l.created_at, l.converted_organization_id,
           p.name AS plan_name
    FROM leads l
    LEFT JOIN plans p ON p.id = l.interested_plan_id
    ORDER BY
      -- Unworked enquiries first; won and lost sink.
      (l.stage IN ('won','lost')) ASC,
      l.created_at DESC
  `);

  return list(rows).map((row) => ({
    id: String(row["id"]),
    name: String(row["name"]),
    email: String(row["email"]),
    company: row["company"] ? String(row["company"]) : null,
    storeUrl: row["store_url"] ? String(row["store_url"]) : null,
    planName: row["plan_name"] ? String(row["plan_name"]) : null,
    wantsDemo: Boolean(row["wants_demo"]),
    message: row["message"] ? String(row["message"]) : null,
    stage: String(row["stage"]),
    createdAt: iso(row["created_at"]) ?? "",
    convertedOrganizationId: row["converted_organization_id"]
      ? String(row["converted_organization_id"])
      : null,
  }));
}

function list(rows: unknown): Record<string, unknown>[] {
  const result = (rows as { rows?: unknown[] }).rows ?? rows;
  return Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
}

function numeric(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}
