"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { db } from "@/db/client";
import { assertPermission, requireAuth } from "@/server/auth-context";
import { createRepurchaseSession, isStripeEnabled } from "@/server/billing/stripe";

import type { ActionResult } from "./tasks";

/**
 * Buy another pack, without a phone call.
 *
 * ── Why this exists when onboarding is sales-led ────────────────────
 * The first purchase needs a conversation: we size the work, recommend a plan
 * and provision the account. The second does not. The customer already knows
 * what a task is worth to them, and the most common moment they need one is the
 * moment they have just used their last — which is exactly when waiting until
 * Monday is most expensive for them and most likely to lose the sale for us.
 *
 * ── What it refuses to take from the browser ────────────────────────
 * Only the plan code. The organisation comes from the session, and the price
 * and task count are read from the plan row on the server. A form that posted
 * an amount would be a form somebody could edit.
 */

const schema = z.object({ planCode: z.string().trim().min(1).max(60) });

export async function startRepurchaseAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  let destination: string;

  try {
    const ctx = await requireAuth();

    // Buying is a billing action. A member who can queue tasks should not be
    // able to spend their employer's money.
    await assertPermission(ctx, "billing:manage");

    if (!isStripeEnabled()) {
      return {
        ok: false,
        error: "Card payment isn't set up yet. Talk to us and we'll send an invoice.",
      };
    }

    const parsed = schema.safeParse({ planCode: formData.get("plan") });
    if (!parsed.success) return { ok: false, error: "Pick a plan to buy." };

    const rows = await db.execute<{
      id: string;
      code: string;
      name: string;
      price_cents: number;
      currency: string;
      task_allowance: number;
    }>(sql`
      SELECT id, code, name, price_cents, currency, task_allowance
      FROM plans
      WHERE code = ${parsed.data.planCode} AND is_active = true AND is_public = true
    `);

    const result = (rows as unknown as { rows?: unknown[] }).rows ?? rows;
    const plan = (Array.isArray(result) ? result[0] : undefined) as
      | {
          id: string;
          code: string;
          name: string;
          price_cents: number;
          currency: string;
          task_allowance: number;
        }
      | undefined;

    if (!plan) {
      return { ok: false, error: "That plan isn't available. Refresh and try again." };
    }

    // Enterprise and anything invoiced has no price to charge. Sending someone
    // to a checkout for $0 is worse than telling them to call.
    if (plan.price_cents <= 0) {
      return {
        ok: false,
        error: "That plan is invoiced rather than paid by card. Talk to us and we'll set it up.",
      };
    }

    const origin = await siteOrigin();
    const session = await createRepurchaseSession({
      organizationId: ctx.organizationId,
      planId: plan.id,
      planCode: plan.code,
      planName: plan.name,
      priceCents: plan.price_cents,
      currency: plan.currency,
      tasksGranted: plan.task_allowance,
      customerEmail: ctx.email,
      // The credits are granted by the webhook, not by this redirect. So
      // success lands on the portal, which reads the real balance — rather than
      // on a page that congratulates somebody on a payment we have not
      // confirmed.
      successUrl: `${origin}/app?purchase=complete`,
      cancelUrl: `${origin}/app?purchase=cancelled`,
    });

    destination = session.url;
  } catch (error) {
    console.error("[repurchase]", error);
    return {
      ok: false,
      error: "We couldn't start that payment. Try again, or talk to us and we'll invoice you.",
    };
  }

  // Outside the try: redirect() signals by throwing, and catching it here would
  // turn a successful checkout into "something went wrong".
  redirect(destination);
}

/**
 * The origin to send Stripe back to.
 *
 * NEXT_PUBLIC_SITE_URL is right in production. On a branch deploy it points at
 * the production domain, which would return the customer to a different
 * deployment than the one they paid from — so the request's own host wins when
 * it disagrees.
 */
async function siteOrigin(): Promise<string> {
  const configured = process.env["NEXT_PUBLIC_SITE_URL"];
  const host = (await headers()).get("host");
  if (!host) return configured ?? "http://localhost:3000";

  const protocol = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const fromRequest = `${protocol}://${host}`;
  return configured && configured.includes(host) ? configured : fromRequest;
}
