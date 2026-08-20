"use server";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db/client";
import { requireInternal } from "@/server/auth-context";
import { adjustCredits, AllowanceError, grantFromPurchase } from "@/server/billing/allowance";
import { clearBlock, estimateTask, ReviewError } from "@/server/billing/review";
import { postComment, CommentError } from "@/server/comments";
import { ForbiddenError } from "@/server/rbac";
import { slugify } from "@/server/onboarding";

import type { ActionResult } from "./tasks";

/**
 * Admin actions.
 *
 * Every one of these begins with `requireInternal()`. That is the entire
 * authorization story for /admin and it must never be assumed from the fact
 * that a page rendered — a server action is a public POST endpoint, reachable
 * without ever loading the page that contains its form.
 */

async function staff() {
  return requireInternal();
}

function fail(error: unknown, fallback: string): ActionResult<never> {
  if (error instanceof ForbiddenError) {
    return { ok: false, error: "That area is restricted to Unbound staff." };
  }
  if (
    error instanceof AllowanceError ||
    error instanceof ReviewError ||
    error instanceof CommentError
  ) {
    return { ok: false, error: error.publicMessage };
  }
  console.error("[admin]", error);
  return { ok: false, error: fallback };
}

/* ── Plans ──────────────────────────────────────────────────────── */

const planSchema = z.object({
  id: z.string().uuid().optional(),
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and hyphens."),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(400).optional(),
  priceCents: z.coerce.number().int().min(0),
  taskAllowance: z.coerce.number().int().min(1, "A pack has to contain at least one task."),
  concurrencyLimit: z.coerce.number().int().min(1, "At least one task must be workable."),
  // Empty means no ceiling, which is different from zero — zero would mean no
  // task of any size is allowed, and would block the plan entirely.
  maxTaskHours: z.union([z.coerce.number().positive(), z.literal("")]).optional(),
  slaHours: z.coerce.number().int().min(1).max(720),
  isPublic: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
});

export async function savePlanAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await staff();

    const parsed = planSchema.safeParse({
      id: emptyToUndefined(formData.get("id")),
      code: formData.get("code"),
      name: formData.get("name"),
      description: emptyToUndefined(formData.get("description")),
      priceCents: formData.get("priceCents"),
      taskAllowance: formData.get("taskAllowance"),
      concurrencyLimit: formData.get("concurrencyLimit"),
      maxTaskHours: (formData.get("maxTaskHours") as string | null) ?? "",
      slaHours: formData.get("slaHours"),
      isPublic: formData.get("isPublic") === "on",
      isActive: formData.get("isActive") === "on",
      sortOrder: emptyToUndefined(formData.get("sortOrder")) ?? 0,
    });

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        ok: false,
        error: issue?.message ?? "Check the plan details.",
        ...(issue?.path[0] ? { field: String(issue.path[0]) } : {}),
      };
    }

    const p = parsed.data;
    const hours = p.maxTaskHours === "" || p.maxTaskHours === undefined ? null : p.maxTaskHours;

    // Upsert on `code`, so editing a plan and creating one are the same path
    // and a duplicated code is caught by the unique index rather than by a
    // read-then-write that two admins could race.
    await db.execute(sql`
      INSERT INTO plans (
        code, name, description, price_cents, task_allowance,
        concurrency_limit, max_task_hours, sla_hours, is_public, is_active, sort_order
      )
      VALUES (
        ${p.code}, ${p.name}, ${p.description ?? null}, ${p.priceCents}, ${p.taskAllowance},
        ${p.concurrencyLimit}, ${hours}, ${p.slaHours},
        ${p.isPublic ?? false}::boolean, ${p.isActive ?? false}::boolean, ${p.sortOrder ?? 0}
      )
      ON CONFLICT (code) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        price_cents = EXCLUDED.price_cents,
        task_allowance = EXCLUDED.task_allowance,
        concurrency_limit = EXCLUDED.concurrency_limit,
        max_task_hours = EXCLUDED.max_task_hours,
        sla_hours = EXCLUDED.sla_hours,
        is_public = EXCLUDED.is_public,
        is_active = EXCLUDED.is_active,
        sort_order = EXCLUDED.sort_order
    `);

    // Editing a plan does NOT rewrite what existing customers are on. Their
    // limits were copied onto the organisation at purchase, and a price change
    // must not silently retitrate somebody's live account.
    revalidatePath("/admin/plans");
    revalidatePath("/pricing");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return fail(error, "That plan could not be saved.");
  }
}

/* ── Customers ──────────────────────────────────────────────────── */

const provisionSchema = z.object({
  organizationName: z.string().trim().min(2, "Give the workspace a name.").max(80),
  ownerName: z.string().trim().min(2, "Give the owner a name.").max(120),
  ownerEmail: z.string().trim().email("That email doesn't look right.").max(200),
  planCode: z.string().trim().min(1, "Pick a plan."),
  leadId: z.string().uuid().optional(),
});

/**
 * Create a customer account.
 *
 * The whole of Path B in one action: organisation, owner, membership, purchase
 * and credit grant. Returns a one-time password for the admin to hand over.
 *
 * ── Why the password is generated, not chosen ───────────────────────
 * An admin typing a password for someone else means it gets reused, written in
 * a CRM, or set to the company name. Generating it means the credential is
 * strong by construction and the admin's only job is to pass it on.
 */
export async function provisionCustomerAction(
  _prev: ActionResult<{ email: string; password: string; organization: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ email: string; password: string; organization: string }>> {
  try {
    const me = await staff();

    const parsed = provisionSchema.safeParse({
      organizationName: formData.get("organizationName"),
      ownerName: formData.get("ownerName"),
      ownerEmail: formData.get("ownerEmail"),
      planCode: formData.get("planCode"),
      leadId: emptyToUndefined(formData.get("leadId")),
    });

    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        ok: false,
        error: issue?.message ?? "Check the details.",
        ...(issue?.path[0] ? { field: String(issue.path[0]) } : {}),
      };
    }

    const input = parsed.data;
    const password = generatePassword();

    // Better Auth owns password hashing, so the account is created through it
    // rather than by writing a hash here. Two hashing implementations for one
    // password column is how a login silently stops working.
    const { auth } = await import("@/lib/auth");
    let userId: string;

    try {
      const created = await auth.api.signUpEmail({
        body: { email: input.ownerEmail, password, name: input.ownerName },
      });
      userId = created.user.id;
    } catch (error) {
      // Almost always a duplicate address. Say so plainly — an admin
      // provisioning an existing customer needs to know that, not a stack.
      console.error("[admin provision]", error);
      return {
        ok: false,
        error: "That email already has an account. Add them to the workspace instead.",
        field: "ownerEmail",
      };
    }

    const slug = `${slugify(input.organizationName)}-${randomBytes(2).toString("hex")}`;

    const rows = await db.execute<{ organization_id: string; purchase_id: string }>(sql`
      WITH plan AS (
        SELECT * FROM plans WHERE code = ${input.planCode} AND is_active
      ),
      org AS (
        INSERT INTO organizations (name, slug, billing_type, provisioned_by, status)
        SELECT ${input.organizationName}, ${slug}, 'invoice', ${me.userId}::uuid, 'active'
        FROM plan
        RETURNING id
      ),
      owner AS (
        INSERT INTO memberships (organization_id, user_id, role)
        SELECT org.id, ${userId}::uuid, 'owner' FROM org
      ),
      purchase AS (
        -- Recorded as pending. Credits are granted only once a payment is
        -- marked received, so provisioning an account cannot hand out work
        -- before the money arrives.
        INSERT INTO plan_purchases (
          organization_id, plan_id, status, method, tasks_granted, price_cents_paid,
          concurrency_at_purchase, max_task_hours_at_purchase, sla_hours_at_purchase,
          recorded_by, note
        )
        SELECT org.id, plan.id, 'pending', 'invoice', plan.task_allowance, plan.price_cents,
               plan.concurrency_limit, plan.max_task_hours, plan.sla_hours,
               ${me.userId}::uuid, 'Created with the account'
        FROM org, plan
        RETURNING id
      )
      SELECT org.id AS organization_id, purchase.id AS purchase_id FROM org, purchase
    `);

    const created = first<{ organization_id: string; purchase_id: string }>(rows);
    if (!created) {
      return { ok: false, error: "That plan is not active. Pick another.", field: "planCode" };
    }

    if (input.leadId) {
      await db.execute(sql`
        UPDATE leads SET stage = 'won', converted_organization_id = ${created.organization_id}
        WHERE id = ${input.leadId}
      `);
    }

    revalidatePath("/admin/customers");
    revalidatePath("/admin/leads");

    return {
      ok: true,
      data: {
        email: input.ownerEmail,
        password,
        organization: input.organizationName,
      },
    };
  } catch (error) {
    return fail(error, "That customer could not be created.");
  }
}

/**
 * Mark a purchase paid and release the credits.
 *
 * Deliberately two steps from provisioning: an account can exist before the
 * money lands, but tasks cannot.
 */
export async function markPurchasePaidAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const me = await staff();

    const purchaseId = z.string().uuid().safeParse(formData.get("purchaseId"));
    if (!purchaseId.success) return { ok: false, error: "That purchase could not be found." };

    const reference = String(formData.get("reference") ?? "").trim().slice(0, 120);

    await db.execute(sql`
      UPDATE plan_purchases SET
        status = 'paid',
        paid_at = COALESCE(paid_at, now()),
        invoice_number = NULLIF(${reference}, ''),
        recorded_by = ${me.userId}::uuid
      WHERE id = ${purchaseId.data} AND status = 'pending'
    `);

    // Idempotent by construction: grantFromPurchase refuses a purchase that
    // already has a grant in the ledger, so a double-click cannot double-credit.
    await grantFromPurchase({ purchaseId: purchaseId.data, actorId: me.userId });

    revalidatePath("/admin/customers");
    return { ok: true };
  } catch (error) {
    return fail(error, "That payment could not be recorded.");
  }
}

/** Sell another pack to an existing customer. */
export async function addPurchaseAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const me = await staff();

    const parsed = z
      .object({
        organizationId: z.string().uuid(),
        planCode: z.string().trim().min(1),
        markPaid: z.boolean().optional(),
      })
      .safeParse({
        organizationId: formData.get("organizationId"),
        planCode: formData.get("planCode"),
        markPaid: formData.get("markPaid") === "on",
      });

    if (!parsed.success) return { ok: false, error: "Check the details and try again." };

    const rows = await db.execute<{ id: string }>(sql`
      WITH plan AS (SELECT * FROM plans WHERE code = ${parsed.data.planCode} AND is_active)
      INSERT INTO plan_purchases (
        organization_id, plan_id, status, method, tasks_granted, price_cents_paid,
        concurrency_at_purchase, max_task_hours_at_purchase, sla_hours_at_purchase,
        recorded_by, paid_at
      )
      SELECT ${parsed.data.organizationId}::uuid, plan.id,
             ${parsed.data.markPaid ? "paid" : "pending"}::purchase_status,
             'invoice', plan.task_allowance, plan.price_cents,
             plan.concurrency_limit, plan.max_task_hours, plan.sla_hours,
             ${me.userId}::uuid,
             CASE WHEN ${parsed.data.markPaid ?? false}::boolean THEN now() ELSE NULL END
      FROM plan
      RETURNING id
    `);

    const created = first<{ id: string }>(rows);
    if (!created) return { ok: false, error: "That plan is not active." };

    if (parsed.data.markPaid) {
      await grantFromPurchase({ purchaseId: created.id, actorId: me.userId });
    }

    revalidatePath("/admin/customers");
    return { ok: true };
  } catch (error) {
    return fail(error, "That pack could not be added.");
  }
}

/** Per-customer overrides — the negotiated exception, without a new plan tier. */
export async function updateCustomerLimitsAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await staff();

    const parsed = z
      .object({
        organizationId: z.string().uuid(),
        concurrencyLimit: z.coerce.number().int().min(1).max(50),
        slaHours: z.coerce.number().int().min(1).max(720),
        maxTaskHours: z.union([z.coerce.number().positive(), z.literal("")]).optional(),
      })
      .safeParse({
        organizationId: formData.get("organizationId"),
        concurrencyLimit: formData.get("concurrencyLimit"),
        slaHours: formData.get("slaHours"),
        maxTaskHours: (formData.get("maxTaskHours") as string | null) ?? "",
      });

    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Check those numbers." };
    }

    const hours =
      parsed.data.maxTaskHours === "" || parsed.data.maxTaskHours === undefined
        ? null
        : parsed.data.maxTaskHours;

    await db.execute(sql`
      UPDATE organizations SET
        concurrency_limit = ${parsed.data.concurrencyLimit},
        sla_hours = ${parsed.data.slaHours},
        max_task_hours = ${hours}
      WHERE id = ${parsed.data.organizationId}
    `);

    revalidatePath("/admin/customers");
    return { ok: true };
  } catch (error) {
    return fail(error, "Those limits could not be saved.");
  }
}

/** Goodwill credits, corrections, migrations. Always with a reason. */
export async function adjustCreditsAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const me = await staff();

    const parsed = z
      .object({
        organizationId: z.string().uuid(),
        delta: z.coerce.number().int(),
        reason: z.string().trim().min(3, "Say why you're adjusting this."),
      })
      .safeParse({
        organizationId: formData.get("organizationId"),
        delta: formData.get("delta"),
        reason: formData.get("reason"),
      });

    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the adjustment." };
    }

    await adjustCredits({
      organizationId: parsed.data.organizationId,
      actorId: me.userId,
      delta: parsed.data.delta,
      reason: parsed.data.reason,
    });

    revalidatePath("/admin/customers");
    return { ok: true };
  } catch (error) {
    return fail(error, "That adjustment could not be applied.");
  }
}

/* ── Task review ────────────────────────────────────────────────── */

export async function estimateTaskAction(
  _prev: ActionResult<{ blocked: boolean; message: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ blocked: boolean; message: string }>> {
  try {
    const me = await staff();

    const parsed = z
      .object({ taskId: z.string().uuid(), hours: z.coerce.number().min(0).max(9999) })
      .safeParse({ taskId: formData.get("taskId"), hours: formData.get("hours") });

    if (!parsed.success) return { ok: false, error: "Enter the estimate in hours." };

    const outcome = await estimateTask({
      taskId: parsed.data.taskId,
      actorId: me.userId,
      hours: parsed.data.hours,
    });

    revalidatePath("/admin");
    revalidatePath("/app");

    return {
      ok: true,
      data: {
        blocked: !outcome.allowed,
        message: outcome.allowed
          ? `Estimated at ${parsed.data.hours}h — cleared to start.`
          : `Held: over the plan ceiling.${
              outcome.suggestedPlan ? ` ${outcome.suggestedPlan.name} would cover it.` : ""
            }`,
      },
    };
  } catch (error) {
    return fail(error, "That estimate could not be saved.");
  }
}

export async function clearBlockAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const me = await staff();
    const taskId = z.string().uuid().safeParse(formData.get("taskId"));
    if (!taskId.success) return { ok: false, error: "That task could not be found." };

    const reason = String(formData.get("reason") ?? "").trim();
    if (reason.length < 3) return { ok: false, error: "Say why you're absorbing this one." };

    const done = await clearBlock({ taskId: taskId.data, actorId: me.userId, reason });
    if (!done) return { ok: false, error: "That task isn't held." };

    revalidatePath("/admin");
    return { ok: true };
  } catch (error) {
    return fail(error, "That block could not be lifted.");
  }
}

export async function adminCommentAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const me = await staff();

    const parsed = z
      .object({
        taskId: z.string().uuid(),
        organizationId: z.string().uuid(),
        body: z.string().trim().min(1),
        isInternal: z.boolean().optional(),
      })
      .safeParse({
        taskId: formData.get("taskId"),
        organizationId: formData.get("organizationId"),
        body: formData.get("body"),
        isInternal: formData.get("isInternal") === "on",
      });

    if (!parsed.success) return { ok: false, error: "Write something first." };

    await postComment({
      taskId: parsed.data.taskId,
      organizationId: parsed.data.organizationId,
      authorId: me.userId,
      body: parsed.data.body,
      isInternal: parsed.data.isInternal,
      authorIsInternal: true,
    });

    revalidatePath("/admin");
    return { ok: true };
  } catch (error) {
    return fail(error, "That comment could not be posted.");
  }
}

/* ── Leads ──────────────────────────────────────────────────────── */

export async function updateLeadStageAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const me = await staff();

    const parsed = z
      .object({
        leadId: z.string().uuid(),
        stage: z.enum(["new", "contacted", "demo_booked", "won", "lost"]),
      })
      .safeParse({ leadId: formData.get("leadId"), stage: formData.get("stage") });

    if (!parsed.success) return { ok: false, error: "That stage isn't valid." };

    await db.execute(sql`
      UPDATE leads SET stage = ${parsed.data.stage}::lead_stage,
                       assigned_to = COALESCE(assigned_to, ${me.userId}::uuid)
      WHERE id = ${parsed.data.leadId}
    `);

    revalidatePath("/admin/leads");
    return { ok: true };
  } catch (error) {
    return fail(error, "That lead could not be updated.");
  }
}

/* ── Helpers ────────────────────────────────────────────────────── */

/**
 * A handover password.
 *
 * Unambiguous alphabet — no 0/O, 1/l/I — because this gets read down a phone
 * line or pasted from a call, and a password nobody can transcribe becomes a
 * password reset within the hour.
 */
function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(20);
  let out = "";
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  // Better Auth is configured with a 12-character minimum; 20 is comfortably
  // over it and still short enough to read aloud.
  return out;
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function first<T>(rows: unknown): T | undefined {
  const result = (rows as { rows?: unknown[] }).rows ?? rows;
  return (Array.isArray(result) ? (result[0] as T | undefined) : undefined) ?? undefined;
}

/* ── Staff ──────────────────────────────────────────────────────── */

/**
 * Grant or revoke internal access.
 *
 * Until now this was a manual SQL UPDATE, which meant nobody but the person who
 * built the database could add a colleague to /admin.
 *
 * The M0 CHECK constraint requires `internal_role` whenever `is_internal` is
 * set, so the two always move together — "staff with no role" is not a state
 * the schema allows, and this action does not try to produce one.
 */
export async function setStaffAccessAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const me = await staff();

    const parsed = z
      .object({
        email: z.string().trim().email("That email doesn't look right."),
        role: z.enum(["engineer", "pm", "superadmin"]).optional(),
        revoke: z.boolean().optional(),
      })
      .safeParse({
        email: formData.get("email"),
        role: emptyToUndefined(formData.get("role")) ?? "engineer",
        revoke: formData.get("revoke") === "true",
      });

    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the details.", field: "email" };
    }

    // Removing your own access locks you out of the page you are standing on,
    // and if you are the last superadmin it locks everyone out permanently.
    // The second case has no recovery inside the product at all.
    if (parsed.data.revoke) {
      const remaining = await db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM users
        WHERE is_internal AND internal_role = 'superadmin' AND lower(email) <> lower(${parsed.data.email})
      `);
      const left = first<{ n: number }>(remaining)?.n ?? 0;
      if (left === 0) {
        return {
          ok: false,
          error: "That's the last superadmin. Promote someone else first, or nobody can get back in.",
        };
      }
    }

    const rows = await db.execute<{ id: string }>(sql`
      UPDATE users SET
        is_internal = ${!parsed.data.revoke}::boolean,
        internal_role = ${parsed.data.revoke ? null : (parsed.data.role ?? "engineer")}::internal_role
      WHERE lower(email) = lower(${parsed.data.email})
      RETURNING id
    `);

    if (!first<{ id: string }>(rows)) {
      return {
        ok: false,
        error: "No account with that email. They need to register first.",
        field: "email",
      };
    }

    await db.execute(sql`
      INSERT INTO audit_logs (actor_id, action, metadata)
      VALUES (
        ${me.userId}::uuid,
        ${parsed.data.revoke ? "staff.revoked" : "staff.granted"},
        ${JSON.stringify({ email: parsed.data.email, role: parsed.data.role ?? null })}::jsonb
      )
    `);

    revalidatePath("/admin/team");
    return { ok: true };
  } catch (error) {
    return fail(error, "That change could not be applied.");
  }
}

/* ── Assignment ─────────────────────────────────────────────────── */

/**
 * Give a task an owner, or hand it back.
 *
 * An empty assignee means unassign, which is a real action rather than an
 * oversight — an engineer going on leave needs to release their queue.
 */
export async function assignTaskAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const me = await staff();

    const parsed = z
      .object({
        taskId: z.string().uuid(),
        assigneeId: z.union([z.string().uuid(), z.literal("")]).optional(),
      })
      .safeParse({
        taskId: formData.get("taskId"),
        assigneeId: (formData.get("assigneeId") as string | null) ?? "",
      });

    if (!parsed.success) return { ok: false, error: "That assignment isn't valid." };

    const { assignTask, AssignmentError } = await import("@/server/assignment");

    try {
      await assignTask({
        taskId: parsed.data.taskId,
        assigneeId:
          parsed.data.assigneeId === "" || parsed.data.assigneeId === undefined
            ? null
            : parsed.data.assigneeId,
        actorId: me.userId,
      });
    } catch (error) {
      if (error instanceof AssignmentError) return { ok: false, error: error.publicMessage };
      throw error;
    }

    revalidatePath("/admin");
    return { ok: true };
  } catch (error) {
    return fail(error, "That task could not be assigned.");
  }
}
