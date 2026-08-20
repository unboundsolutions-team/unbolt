import { NextResponse, type NextRequest } from "next/server";

import { verifyWebhookHmac } from "@/server/shopify/hmac";
import { disconnectByDomain } from "@/server/shopify/store-service";

export const dynamic = "force-dynamic";

/**
 * Shopify webhooks.
 *
 * ── The two rules that make this endpoint safe ──────────────────────
 *
 * 1. **Verify against the RAW body.** `request.text()` before any parsing. The
 *    HMAC covers the exact bytes Shopify sent, so parsing to JSON and
 *    re-serialising changes key order and whitespace and the signature will
 *    never match again. The tempting fix for that is to stop verifying, which
 *    turns this into an unauthenticated endpoint that deletes merchants' tokens
 *    on request.
 *
 * 2. **Reject before doing anything.** No logging of the payload, no lookups,
 *    no side effects until the signature checks out.
 *
 * ── Why every response is 200 once verified ─────────────────────────
 * Shopify retries non-2xx for 48 hours and removes the subscription after
 * repeated failures. A topic we do not handle is not an error — returning 404
 * for it would eventually get our webhook deleted. So: 401 for an unverified
 * request, 200 for everything else, and real problems go to the log.
 */

/** Topics Shopify makes mandatory for public app review. */
const GDPR_TOPICS = new Set([
  "customers/data_request",
  "customers/redact",
  "shop/redact",
]);

export async function POST(request: NextRequest) {
  const secret = process.env["SHOPIFY_API_SECRET"];
  if (!secret) {
    console.error("[shopify webhook] SHOPIFY_API_SECRET is not set; refusing all webhooks.");
    // 500 rather than 200: this IS an outage on our side, and Shopify retrying
    // is exactly what we want once the variable is fixed.
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }

  // Raw bytes, before anything else touches them.
  const rawBody = await request.text();
  const signature = request.headers.get("x-shopify-hmac-sha256");

  if (!verifyWebhookHmac(rawBody, signature, secret)) {
    // Deliberately terse. An attacker probing this endpoint learns nothing
    // about why their signature was wrong.
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const topic = request.headers.get("x-shopify-topic") ?? "";
  const shopHeader = request.headers.get("x-shopify-shop-domain") ?? "";

  let payload: Record<string, unknown> = {};
  try {
    payload = rawBody.length > 0 ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
  } catch {
    console.error(`[shopify webhook] ${topic} carried a signed but unparseable body.`);
    return NextResponse.json({ ok: true });
  }

  try {
    await handle(topic, shopHeader, payload);
  } catch (error) {
    // Logged, not retried. A bug in our handler will still be a bug on the
    // fifth delivery, and 48 hours of retries buries the real signal.
    console.error(`[shopify webhook] handler failed for ${topic}`, error);
  }

  return NextResponse.json({ ok: true });
}

async function handle(
  topic: string,
  shopHeader: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (topic === "app/uninstalled") {
    // The token is already dead on Shopify's side the moment a merchant
    // uninstalls. Keeping our copy would mean showing a store as connected
    // when it is not, and holding a credential we have no right to.
    //
    // The domain comes from the header, which is inside the HMAC, so it is as
    // trustworthy as the signature. It is still re-validated as a shop domain
    // by disconnectByDomain.
    const shop = shopHeader || String(payload["myshopify_domain"] ?? payload["domain"] ?? "");
    const affected = await disconnectByDomain(shop);
    console.log(`[shopify webhook] app/uninstalled ${shop} — ${affected} store(s) disconnected`);
    return;
  }

  if (GDPR_TOPICS.has(topic)) {
    await handleGdpr(topic, shopHeader);
    return;
  }

  console.log(`[shopify webhook] unhandled topic ${topic} from ${shopHeader}`);
}

/**
 * The three mandatory privacy topics.
 *
 * Shopify requires all three to exist and return 200 before a public app passes
 * review. They are answered honestly rather than stubbed:
 *
 *  - `customers/data_request` — we hold no customer PII. The scopes we request
 *    are read-only and we never read `read_customers`, so there is nothing to
 *    assemble. That is the correct answer, and it stays correct only while that
 *    remains true — which is why adding a customer scope must revisit this.
 *  - `customers/redact` — same: nothing stored, nothing to erase.
 *  - `shop/redact` — arrives 48h after uninstall. The token is already gone
 *    from `app/uninstalled`; the store row is retained because tasks reference
 *    it and it holds no shop PII beyond a domain the merchant chose publicly.
 */
async function handleGdpr(topic: string, shop: string): Promise<void> {
  switch (topic) {
    case "customers/data_request":
    case "customers/redact":
      console.log(
        `[shopify webhook] ${topic} for ${shop}: no customer data is stored by this app.`,
      );
      return;
    case "shop/redact": {
      const affected = await disconnectByDomain(shop);
      console.log(`[shopify webhook] shop/redact ${shop} — ${affected} credential(s) cleared`);
      return;
    }
    default:
      return;
  }
}
