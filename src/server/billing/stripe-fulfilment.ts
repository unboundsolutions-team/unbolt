import { sql } from "drizzle-orm";

import { db } from "@/db/client";

import { AllowanceError, grantFromPurchase } from "./allowance";

/**
 * Turn a completed Checkout Session into credits.
 *
 * ── Every guard here exists because webhooks are not a request/response ──
 * Stripe retries. It retries on a timeout, on a 500, and on a deploy that
 * happened mid-request. It can deliver the same event twice for reasons on its
 * side. So the question is never "did this work", it is "what happens the
 * fourth time this arrives".
 *
 * Three things make that safe, and none of them is a transaction — the HTTP
 * driver has none:
 *
 *  1. `plan_purchases` has a unique partial index on stripe_checkout_session_id,
 *     so a second delivery cannot create a second purchase row. The INSERT
 *     resolves the conflict by doing nothing and selecting the existing row.
 *  2. `grantFromPurchase` refuses any purchase that already has a 'grant' row
 *     in the credit ledger.
 *  3. The amount granted comes from the PLAN, read at fulfilment time, not from
 *     the session metadata. Metadata is round-tripped through the client and a
 *     forged-but-signed session is not the threat — a stale one is: a customer
 *     who opens checkout, waits while an admin edits the plan, then pays.
 */

export interface FulfilmentResult {
  status: "granted" | "already-granted" | "ignored";
  organizationId?: string;
  purchaseId?: string;
  reason?: string;
}

export async function fulfilCheckoutSession(session: {
  id: string;
  paymentStatus: string | null;
  paymentIntentId: string | null;
  amountTotal: number | null;
  currency: string | null;
  organizationId: string | undefined;
  planId: string | undefined;
}): Promise<FulfilmentResult> {
  // `checkout.session.completed` fires for asynchronous methods before the money
  // has actually arrived. Granting on it would hand out tasks for a payment that
  // can still fail.
  if (session.paymentStatus !== "paid") {
    return { status: "ignored", reason: `payment_status was "${session.paymentStatus}"` };
  }

  if (!session.organizationId || !session.planId) {
    // Not ours, or created by hand in the Stripe dashboard. Either way there is
    // no workspace to credit and guessing would credit the wrong one.
    return { status: "ignored", reason: "session carried no organisation or plan" };
  }

  const rows = await db.execute<{ id: string; already_granted: boolean }>(sql`
    WITH plan AS (
      SELECT id, task_allowance, concurrency_limit, max_task_hours, sla_hours
      FROM plans
      WHERE id = ${session.planId}::uuid AND is_active = true
    ),
    inserted AS (
      INSERT INTO plan_purchases (
        organization_id, plan_id, status, method, tasks_granted,
        price_cents_paid, currency,
        concurrency_at_purchase, max_task_hours_at_purchase, sla_hours_at_purchase,
        stripe_checkout_session_id, stripe_payment_intent_id, paid_at
      )
      SELECT ${session.organizationId}::uuid, plan.id, 'paid', 'stripe',
             -- From the plan row, not from what the browser sent back.
             plan.task_allowance,
             ${session.amountTotal ?? 0}, ${(session.currency ?? "usd").toUpperCase()},
             plan.concurrency_limit, plan.max_task_hours, plan.sla_hours,
             ${session.id}, ${session.paymentIntentId}, now()
      FROM plan
      -- The unique partial index on stripe_checkout_session_id is what makes a
      -- redelivery a no-op rather than a second pack.
      --
      -- The WHERE clause is not decoration: the index is PARTIAL (it excludes
      -- NULLs, because the manual and invoiced purchases that make up most rows
      -- have no session id). Postgres will not use a partial index as the
      -- arbiter unless the statement repeats its predicate, and without it this
      -- fails outright with "no unique or exclusion constraint matching the ON
      -- CONFLICT specification".
      ON CONFLICT (stripe_checkout_session_id)
        WHERE stripe_checkout_session_id IS NOT NULL
        DO NOTHING
      RETURNING id
    )
    SELECT id, false AS already_granted FROM inserted
    UNION ALL
    -- Redelivery: the row is already there, so find it rather than failing.
    SELECT id, true AS already_granted FROM plan_purchases
    WHERE stripe_checkout_session_id = ${session.id}
      AND NOT EXISTS (SELECT 1 FROM inserted)
    LIMIT 1
  `);

  const result = (rows as unknown as { rows?: unknown[] }).rows ?? rows;
  const purchase = (Array.isArray(result) ? result[0] : undefined) as
    | { id: string; already_granted: boolean }
    | undefined;

  if (!purchase) {
    // The plan was deactivated between checkout opening and the money landing.
    // Refusing loudly is right: this needs a person, not a silent grant of an
    // allowance nobody sells any more.
    return { status: "ignored", reason: "no active plan matched the session" };
  }

  /*
   * grantFromPurchase THROWS when the grant already landed.
   *
   * That is right for an admin clicking a button — they should be told the
   * payment was already applied. It is wrong here. A webhook that throws
   * returns 500, Stripe treats 500 as "try again", and a perfectly normal
   * redelivery becomes an endless retry loop filling the log with errors about
   * a situation that is entirely expected.
   *
   * So the already-granted case is caught and reported as success, which is
   * what it is: the credits are there.
   */
  try {
    const granted = await grantFromPurchase({ purchaseId: purchase.id });
    return {
      status: "granted",
      organizationId: granted.organizationId,
      purchaseId: purchase.id,
    };
  } catch (error) {
    if (error instanceof AllowanceError) {
      return {
        status: "already-granted",
        organizationId: session.organizationId,
        purchaseId: purchase.id,
      };
    }
    throw error;
  }
}
