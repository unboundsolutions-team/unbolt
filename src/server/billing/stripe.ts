import Stripe from "stripe";

/**
 * Stripe, for repurchase only.
 *
 * ── What this is and is not for ─────────────────────────────────────
 * Onboarding stays sales-led: a new customer picks a plan, we size the work on
 * a call, and an admin provisions the account after payment. That is the model
 * and nothing here changes it.
 *
 * What this handles is the second purchase. A customer who has used their last
 * task at 2am should not have to wait for someone to pick up the phone before
 * they can queue the next one — and "buy the same pack again, or upgrade" is
 * exactly the transaction that needs no conversation, because the work has
 * already been sized and the relationship already exists.
 *
 * ── Off is a supported state ────────────────────────────────────────
 * With no STRIPE_SECRET_KEY every function here reports unavailable and the
 * admin path is untouched. That is how the product runs today, so it is the
 * case that must not break.
 */

let cached: Stripe | null = null;

export function isStripeEnabled(): boolean {
  return Boolean(process.env["STRIPE_SECRET_KEY"] && process.env["STRIPE_WEBHOOK_SECRET"]);
}

/**
 * Both variables or neither.
 *
 * A secret key with no webhook secret is the dangerous half-configuration: card
 * payments succeed, Stripe's confirmation cannot be verified, and the customer
 * has paid for credits that were never granted. Refusing to enable checkout at
 * all is the correct response to that state, not a warning in a log.
 */
function client(): Stripe {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) throw new StripeNotConfigured();
  if (!process.env["STRIPE_WEBHOOK_SECRET"]) {
    throw new StripeNotConfigured(
      "STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is not. Checkout is " +
        "disabled: a payment we cannot verify is a payment that would never " +
        "grant credits.",
    );
  }
  // No explicit apiVersion: the SDK pins the version it was generated against
  // (see node_modules/stripe/cjs/apiVersion.js). Naming one here means guessing
  // a string that must match, and a wrong guess fails at the first API call
  // rather than at build time.
  cached ??= new Stripe(key, { typescript: true });
  return cached;
}

export class StripeNotConfigured extends Error {
  constructor(message = "Stripe is not configured.") {
    super(message);
    this.name = "StripeNotConfigured";
  }
}

/**
 * A Checkout Session for one more pack.
 *
 * The organisation and plan are put in `metadata` and in `client_reference_id`
 * rather than being looked up from the customer's email on the way back. An
 * email is not an identity here — one person can own two workspaces — and
 * resolving a payment to the wrong workspace credits the wrong account.
 */
export async function createRepurchaseSession(input: {
  organizationId: string;
  planId: string;
  planCode: string;
  planName: string;
  priceCents: number;
  currency: string;
  tasksGranted: number;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ id: string; url: string }> {
  const session = await client().checkout.sessions.create({
    mode: "payment",
    client_reference_id: input.organizationId,
    customer_email: input.customerEmail,
    metadata: {
      organizationId: input.organizationId,
      planId: input.planId,
      planCode: input.planCode,
      tasksGranted: String(input.tasksGranted),
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: input.currency.toLowerCase(),
          unit_amount: input.priceCents,
          product_data: {
            name: `${input.planName} pack`,
            description: `${input.tasksGranted} engineering tasks. Bought once; nothing renews.`,
          },
        },
      },
    ],
    // Stripe's own idempotency is per-request; ours is the unique index on
    // stripe_checkout_session_id plus the ledger check in grantFromPurchase.
    // This just keeps a double-clicked button from opening two sessions.
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  });

  if (!session.url) {
    throw new Error("Stripe returned a session with no URL to send the customer to.");
  }
  return { id: session.id, url: session.url };
}

/**
 * Verify a webhook delivery.
 *
 * ── Why the raw body matters ────────────────────────────────────────
 * The signature is computed over the exact bytes Stripe sent. Parsing the JSON
 * and re-serialising it changes key order and whitespace, and verification then
 * fails for every legitimate delivery — which reads like Stripe being broken.
 * The route handler must pass `await request.text()`, never a parsed object.
 *
 * An unverifiable payload is indistinguishable from a forged one, and this
 * endpoint grants credits. So there is no fallback path and no "allow if the
 * secret is missing" branch: without the secret this throws.
 */
export function verifyWebhook(rawBody: string, signature: string | null): StripeEvent {
  const secret = process.env["STRIPE_WEBHOOK_SECRET"];
  if (!secret) throw new StripeNotConfigured("STRIPE_WEBHOOK_SECRET is not set.");
  if (!signature) throw new Error("No Stripe signature on the request.");

  // constructEvent also enforces the timestamp tolerance, which is what stops a
  // captured payload being replayed days later.
  //
  // Narrowed to StripeEvent on the way out. The SDK's own Stripe.Event is a
  // discriminated union of several hundred members, and this app reads five
  // fields from one of them. The narrow type is a record of exactly what the
  // webhook depends on; the runtime object is unchanged.
  return client().webhooks.constructEvent(rawBody, signature, secret) as unknown as StripeEvent;
}

/**
 * The shape this app actually reads off a webhook.
 *
 * Deliberately hand-written and small. Anything not listed here is not used;
 * if that changes, this type is where it has to be added, which is a better
 * record of the dependency than importing everything Stripe can send.
 */
export interface StripeCheckoutSession {
  id: string;
  payment_status: string | null;
  payment_intent: string | { id: string } | null;
  amount_total: number | null;
  currency: string | null;
  metadata: Record<string, string> | null;
}

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: StripeCheckoutSession };
}
