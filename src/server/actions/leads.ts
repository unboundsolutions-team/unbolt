"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { headers } from "next/headers";

import { db } from "@/db/client";
import { clientIdentifier, consumeRateLimit } from "@/server/rate-limit";

import type { ActionResult } from "./tasks";

/**
 * The contact form — now the only way in.
 *
 * Self-serve checkout is deliberately not wired: a customer picks a plan, we
 * size the work on a call, and an admin provisions the account after payment.
 * That makes this form the top of the funnel rather than a politeness, so a
 * submission has to become a durable record an admin can work, not an email to
 * a shared inbox.
 */

const schema = z.object({
  name: z.string().trim().min(2, "Tell us your name.").max(120),
  email: z.string().trim().email("That email doesn't look right.").max(200),
  company: z.string().trim().max(160).optional(),
  storeUrl: z.string().trim().max(300).optional(),
  planCode: z.string().trim().max(60).optional(),
  wantsDemo: z.boolean().optional(),
  message: z.string().trim().max(4000).optional(),
});

/**
 * How long between submissions from one address.
 *
 * The form is public and unauthenticated. Without a cap it is a way to fill the
 * sales pipeline with noise, and the person who suffers is whoever has to sort
 * real enquiries out of it in the morning.
 */
const DUPLICATE_WINDOW_MINUTES = 10;

export async function submitLeadAction(
  _prev: ActionResult<{ name: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ name: string }>> {
  const parsed = schema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    company: emptyToUndefined(formData.get("company")),
    storeUrl: emptyToUndefined(formData.get("store")),
    planCode: emptyToUndefined(formData.get("plan")),
    wantsDemo: formData.get("demo") === "on" || formData.get("demo") === "true",
    message: emptyToUndefined(formData.get("message")),
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue?.message ?? "Check the form and try again.",
      ...(issue?.path[0] ? { field: String(issue.path[0]) } : {}),
    };
  }

  const data = parsed.data;

  // The duplicate window below stops one address filing repeatedly; this stops
  // one caller filing under a hundred different addresses. Without it the form
  // is a way to bury real enquiries in noise, and the person who pays for that
  // is whoever triages the pipeline in the morning.
  try {
    const limited = await consumeRateLimit({
      kind: "lead",
      identifier: clientIdentifier(await headers()),
      limit: 5,
      windowSeconds: 3600,
    });

    if (!limited.allowed) {
      return {
        ok: false,
        error: "We've already got a few from you. Give us a chance to reply first.",
      };
    }
  } catch (error) {
    // A limiter that fails must not take the form down with it. Losing a real
    // enquiry costs more than an unlimited hour would.
    console.error("[lead] rate limit check failed, allowing through", error);
  }

  try {
    const rows = await db.execute<{ id: string }>(sql`
      WITH plan AS (
        SELECT id FROM plans WHERE code = ${data.planCode ?? null}
      ),
      recent AS (
        -- A double-click, a refresh, or someone filling it twice. All three
        -- should not produce three rows for a sales team to triage.
        SELECT 1 FROM leads
        WHERE lower(email) = lower(${data.email})
          AND created_at > now() - make_interval(mins => ${DUPLICATE_WINDOW_MINUTES})
      )
      INSERT INTO leads (
        name, email, company, store_url, interested_plan_id, wants_demo, message, qualification
      )
      SELECT ${data.name}, ${data.email}, ${data.company ?? null},
             ${data.storeUrl ?? null}, (SELECT id FROM plan),
             ${data.wantsDemo ?? false}::boolean, ${data.message ?? null},
             ${JSON.stringify({ planCode: data.planCode ?? null })}::jsonb
      WHERE NOT EXISTS (SELECT 1 FROM recent)
      RETURNING id
    `);

    const result = (rows as unknown as { rows?: unknown[] }).rows ?? rows;
    const created = Array.isArray(result) ? result[0] : undefined;

    // A suppressed duplicate is reported as success. Telling someone "you
    // already did that" when they are trying to buy something is a strange way
    // to greet a customer, and they cannot tell the difference anyway.
    if (!created) return { ok: true, data: { name: data.name.split(" ")[0] ?? data.name } };

    return { ok: true, data: { name: data.name.split(" ")[0] ?? data.name } };
  } catch (error) {
    console.error("[lead]", error);
    return {
      ok: false,
      error: "Something went wrong on our side. Email us directly and we'll pick it up.",
    };
  }
}

function emptyToUndefined(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
