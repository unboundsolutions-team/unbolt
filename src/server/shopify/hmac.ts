import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signature verification for the two things Shopify signs.
 *
 * They are signed *differently*, and conflating them is a common bug:
 *
 *  - **OAuth callback / App Bridge query strings** — hex-encoded HMAC-SHA256
 *    over the query parameters, sorted, with the `hmac` (and legacy `signature`)
 *    parameter removed.
 *  - **Webhooks** — base64-encoded HMAC-SHA256 over the *raw request body*.
 *
 * Both comparisons here are constant-time. A `===` on a signature leaks, via
 * response timing, how many leading bytes were correct, which turns forging a
 * signature into a few thousand requests rather than a brute force of the
 * whole space. It costs nothing to do correctly.
 */

/**
 * Compare two strings without leaking where they first differ.
 *
 * Length is compared first and non-constant-time, deliberately: the length of a
 * signature is not a secret (it is fixed by the algorithm), and `timingSafeEqual`
 * throws on mismatched buffer lengths.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Verify the HMAC on an OAuth callback or an embedded-app query string.
 *
 * Shopify's rule: drop `hmac` and `signature`, sort the remaining parameters by
 * key, join as `key=value` with `&`, and HMAC that with the app secret.
 *
 * Repeated keys are joined with commas, which is what Shopify does and what a
 * naive `Object.fromEntries(params)` silently gets wrong by keeping only the
 * last value — producing a valid-looking mismatch that is miserable to debug.
 */
export function verifyQueryHmac(
  params: URLSearchParams,
  secret: string,
): boolean {
  const provided = params.get("hmac");
  if (!provided) return false;

  const grouped = new Map<string, string[]>();
  for (const [key, value] of params) {
    if (key === "hmac" || key === "signature") continue;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(value);
    else grouped.set(key, [value]);
  }

  const message = [...grouped.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, values]) => `${key}=${values.join(",")}`)
    .join("&");

  const expected = createHmac("sha256", secret).update(message, "utf8").digest("hex");
  return safeEqual(expected, provided.toLowerCase());
}

/**
 * Verify a webhook signature against the RAW body.
 *
 * The body must be the exact bytes Shopify sent. Parsing to JSON and
 * re-serialising changes key order, whitespace and unicode escaping, so the
 * signature will never match — and the tempting "fix" for that is to skip
 * verification, which turns the endpoint into an unauthenticated write.
 */
export function verifyWebhookHmac(
  rawBody: string | Buffer,
  header: string | null,
  secret: string,
): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", secret)
    .update(typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody)
    .digest("base64");
  return safeEqual(expected, header);
}

/** Sign a query string the way Shopify would. Used to drive the tests. */
export function signQuery(params: URLSearchParams, secret: string): string {
  const message = [...params.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

/** Sign a webhook body the way Shopify would. Used to drive the tests. */
export function signWebhook(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(Buffer.from(rawBody, "utf8")).digest("base64");
}
