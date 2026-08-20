import { sql } from "drizzle-orm";

import { db } from "@/db/client";

/**
 * Reading plans.
 *
 * The pricing page renders from these rows rather than from a constant, because
 * the plans are administered. Hardcoding "5 tasks" in the marketing copy would
 * mean the page and the product disagree the moment someone edits a plan — and
 * the person editing it would have no way of knowing a deploy was also needed.
 */

export interface PublicPlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  taskAllowance: number;
  concurrencyLimit: number;
  maxTaskHours: number | null;
  slaHours: number;
  isPublic: boolean;
  isActive: boolean;
  sortOrder: number;
}

/** What the pricing page shows: public, active, cheapest first. */
export async function publicPlans(): Promise<PublicPlan[]> {
  return mapPlans(
    await db.execute<Record<string, unknown>>(sql`
      SELECT * FROM plans
      WHERE is_public AND is_active
      ORDER BY sort_order, price_cents
    `),
  );
}

/** Everything, including hidden and retired plans. For /admin. */
export async function allPlans(): Promise<PublicPlan[]> {
  return mapPlans(
    await db.execute<Record<string, unknown>>(sql`
      SELECT * FROM plans ORDER BY is_active DESC, sort_order, price_cents
    `),
  );
}

export async function planByCode(code: string): Promise<PublicPlan | null> {
  const rows = await mapPlans(
    await db.execute<Record<string, unknown>>(sql`SELECT * FROM plans WHERE code = ${code}`),
  );
  return rows[0] ?? null;
}

export async function planById(id: string): Promise<PublicPlan | null> {
  const rows = await mapPlans(
    await db.execute<Record<string, unknown>>(sql`SELECT * FROM plans WHERE id = ${id}`),
  );
  return rows[0] ?? null;
}

function mapPlans(rows: unknown): PublicPlan[] {
  const result = (rows as { rows?: unknown[] }).rows ?? rows;
  const list = Array.isArray(result) ? (result as Record<string, unknown>[]) : [];

  return list.map((row) => ({
    id: String(row["id"]),
    code: String(row["code"]),
    name: String(row["name"]),
    description: row["description"] ? String(row["description"]) : null,
    priceCents: Number(row["price_cents"]),
    currency: String(row["currency"]),
    taskAllowance: Number(row["task_allowance"]),
    concurrencyLimit: Number(row["concurrency_limit"]),
    // numeric comes back as a string from both drivers; Number(null) is 0, and
    // 0 would read as "no work allowed" rather than "no ceiling".
    maxTaskHours: row["max_task_hours"] === null ? null : Number(row["max_task_hours"]),
    slaHours: Number(row["sla_hours"]),
    isPublic: Boolean(row["is_public"]),
    isActive: Boolean(row["is_active"]),
    sortOrder: Number(row["sort_order"]),
  }));
}

/** "$499" — whole units, because every price here is whole. */
export function formatPrice(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/** "48 business hours" / "Same day" — how the SLA is said out loud. */
export function slaLabel(hours: number): string {
  if (hours <= 8) return "Same day";
  return `${hours}-hour response`;
}

/** "Up to 8 hours a task" / "No size limit". */
export function sizeLabel(maxTaskHours: number | null): string {
  if (maxTaskHours === null) return "No size limit per task";
  const rounded = Math.round(maxTaskHours * 100) / 100;
  return `Up to ${rounded} ${rounded === 1 ? "hour" : "hours"} a task`;
}
