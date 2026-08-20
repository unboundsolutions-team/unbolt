import { fulfilCheckoutSession } from "@/server/billing/stripe-fulfilment";
import { isStripeEnabled, verifyWebhook, type StripeEvent } from "@/server/billing/stripe";

/**
 * Stripe's webhook.
 *
 * ── The status code is the protocol ─────────────────────────────────
 * Stripe retries anything that is not 2xx, with backoff, for days. That makes
 * the response code a decision about what happens next, not a formality:
 *
 *   2xx  we have it, stop sending
 *   4xx  we will never accept this, stop sending
 *   5xx  something broke on our side, please send it again
 *
 * Getting this backwards is how a webhook endpoint either loses a payment
 * (200 on an error we swallowed) or drowns in retries (500 on a delivery we
 * were always going to reject). So an unverifiable signature is 400 — retrying
 * it would never help — while a database failure is 500, because it might.
 */

// The signature is computed over the exact bytes Stripe sent, so the body must
// not be parsed or transformed before verification. This route reads text.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  if (!isStripeEnabled()) {
    // Nothing is misconfigured — the product is sales-led and Stripe is
    // optional. Say so rather than 500ing.
    return Response.json({ error: "Stripe is not enabled on this deployment." }, { status: 404 });
  }

  const raw = await request.text();
  const signature = request.headers.get("stripe-signature");

  let event: StripeEvent;
  try {
    event = verifyWebhook(raw, signature);
  } catch (error) {
    // Deliberately terse to the caller. A verification failure is either a
    // forgery or a secret mismatch, and telling an attacker which is unhelpful.
    console.error("[stripe] signature verification failed", error);
    return Response.json({ error: "Invalid signature." }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      // A session paid asynchronously completes first and pays later. Both
      // events run the same fulfilment, which ignores anything not yet paid,
      // so whichever arrives with payment_status 'paid' is the one that grants.
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object;
        const result = await fulfilCheckoutSession({
          id: session.id,
          paymentStatus: session.payment_status,
          paymentIntentId:
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : (session.payment_intent?.id ?? null),
          amountTotal: session.amount_total,
          currency: session.currency,
          organizationId: session.metadata?.["organizationId"] ?? undefined,
          planId: session.metadata?.["planId"] ?? undefined,
        });

        console.log(`[stripe] ${event.type} ${session.id} → ${result.status}`, {
          organizationId: result.organizationId,
          reason: result.reason,
        });
        return Response.json(result);
      }

      default:
        // Acknowledged, not handled. Returning an error for an event type we
        // did not ask for would have Stripe retry it forever.
        return Response.json({ status: "ignored", type: event.type });
    }
  } catch (error) {
    // 500 on purpose: this is our fault and a retry may well succeed. The
    // fulfilment path is idempotent, so a retry is safe.
    console.error(`[stripe] fulfilment failed for ${event.id}`, error);
    return Response.json({ error: "Fulfilment failed." }, { status: 500 });
  }
}

/** A GET here is a person checking the URL, not Stripe. */
export function GET(): Response {
  return Response.json({ error: "This endpoint accepts POST from Stripe only." }, { status: 405 });
}
