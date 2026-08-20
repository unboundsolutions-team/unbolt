import { randomBytes } from "node:crypto";

import { parseShopDomain, shopOrigin, type ShopDomain } from "./domain";
import { verifyQueryHmac } from "./hmac";

/**
 * The OAuth grant itself.
 *
 * Pure and I/O-free apart from the single token exchange, which takes its
 * `fetch` as an argument so the whole flow can be driven against a fake Shopify
 * in tests. There is no Shopify Partner account yet (§10.7 of the brief), so
 * "run it against the real thing" is not available — being able to run it
 * against a faithful fake is the difference between this shipping verified and
 * shipping hopeful.
 */

/**
 * What we ask a merchant for.
 *
 * Deliberately minimal and read-mostly. Every scope on this list has to be
 * justified to the merchant at the consent screen and to Shopify at app review,
 * and an over-broad request is both a worse conversion rate and a bigger blast
 * radius if a token leaks. Write scopes are added when a feature needs them,
 * not in advance.
 */
export const SCOPES = [
  "read_products",
  "read_themes",
  "read_orders",
  "read_script_tags",
] as const;

export const SCOPE_STRING = SCOPES.join(",");

export interface ShopifyConfig {
  apiKey: string;
  apiSecret: string;
  /** Absolute, e.g. https://unbolt.unboundsolutions.in */
  appUrl: string;
}

export class ShopifyOAuthError extends Error {
  constructor(
    message: string,
    /** Safe to show a merchant. Distinct from `message`, which is for logs. */
    readonly publicMessage = "That store could not be connected. Try again from your dashboard.",
  ) {
    super(message);
    this.name = "ShopifyOAuthError";
  }
}

export function loadConfig(env = process.env): ShopifyConfig {
  const apiKey = env["SHOPIFY_API_KEY"];
  const apiSecret = env["SHOPIFY_API_SECRET"];
  const appUrl = env["SHOPIFY_APP_URL"] ?? env["BETTER_AUTH_URL"] ?? env["NEXT_PUBLIC_SITE_URL"];

  if (!apiKey || !apiSecret || !appUrl) {
    throw new ShopifyOAuthError(
      "SHOPIFY_API_KEY, SHOPIFY_API_SECRET and SHOPIFY_APP_URL must all be set.",
      "Store connections are not configured yet. We're on it.",
    );
  }
  return { apiKey, apiSecret, appUrl };
}

/** The redirect_uri, which must match the Partner dashboard entry exactly. */
export function callbackUrl(config: ShopifyConfig): string {
  return new URL("/api/shopify/callback", config.appUrl).toString();
}

/** 32 bytes of CSPRNG. This is the CSRF defence for the whole flow. */
export function generateState(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Where to send the merchant to approve the install.
 *
 * `shop` is a parsed domain, not a string, so there is no way to reach this
 * function with an unvalidated host — the type system carries the check.
 */
export function authorizeUrl(input: {
  config: ShopifyConfig;
  shop: ShopDomain;
  state: string;
}): string {
  const url = new URL("/admin/oauth/authorize", shopOrigin(input.shop));
  url.searchParams.set("client_id", input.config.apiKey);
  url.searchParams.set("scope", SCOPE_STRING);
  url.searchParams.set("redirect_uri", callbackUrl(input.config));
  url.searchParams.set("state", input.state);
  return url.toString();
}

export interface CallbackParams {
  shop: ShopDomain;
  code: string;
  state: string;
}

/**
 * Validate everything about a callback before any of it is trusted.
 *
 * Order matters. The shop domain is checked first because every later step
 * either redirects to it or sends a secret to it, and the HMAC is checked
 * before the code is used because an unsigned callback is not from Shopify at
 * all.
 *
 * Note what this does NOT do: compare the state to anything. It cannot — the
 * expected value lives in the database. It only guarantees a state was present
 * and well-formed, and the caller must do the comparison.
 */
export function parseCallback(
  params: URLSearchParams,
  config: ShopifyConfig,
): CallbackParams {
  const shop = parseShopDomain(params.get("shop"));
  if (!shop) {
    throw new ShopifyOAuthError(
      `Callback carried a shop value that is not a myshopify.com store: ${params.get("shop")}`,
      "That doesn't look like a Shopify store address.",
    );
  }

  if (!verifyQueryHmac(params, config.apiSecret)) {
    throw new ShopifyOAuthError(
      `Callback HMAC failed for ${shop}.`,
      "We couldn't verify that request came from Shopify. Start the connection again.",
    );
  }

  const code = params.get("code");
  if (!code) throw new ShopifyOAuthError("Callback carried no authorization code.");

  const state = params.get("state");
  if (!state) {
    throw new ShopifyOAuthError(
      "Callback carried no state parameter.",
      "That connection link has expired. Start again from your dashboard.",
    );
  }

  return { shop, code, state };
}

export interface AccessTokenResponse {
  accessToken: string;
  scope: string;
}

/**
 * Exchange the authorization code for an access token.
 *
 * `fetchImpl` is injectable so tests can point the exchange at a local fake.
 * The URL is still built from a parsed shop domain, so a test fake has to be
 * reached by substituting fetch — never by passing a different host, which
 * would mean the production path could be redirected too.
 */
export async function exchangeCode(input: {
  config: ShopifyConfig;
  shop: ShopDomain;
  code: string;
  fetchImpl?: typeof fetch;
}): Promise<AccessTokenResponse> {
  const doFetch = input.fetchImpl ?? fetch;
  const url = new URL("/admin/oauth/access_token", shopOrigin(input.shop));

  const response = await doFetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: input.config.apiKey,
      client_secret: input.config.apiSecret,
      code: input.code,
    }),
  });

  if (!response.ok) {
    // The body may echo the secret we just sent; never let it into a log.
    throw new ShopifyOAuthError(
      `Token exchange for ${input.shop} returned ${response.status}.`,
      "Shopify refused the connection. Try again in a moment.",
    );
  }

  const body = (await response.json()) as { access_token?: unknown; scope?: unknown };
  if (typeof body.access_token !== "string" || body.access_token.length === 0) {
    throw new ShopifyOAuthError("Token exchange returned no access_token.");
  }

  return {
    accessToken: body.access_token,
    scope: typeof body.scope === "string" ? body.scope : SCOPE_STRING,
  };
}

/**
 * Did the merchant actually grant what we asked for?
 *
 * A merchant can install an app whose granted scopes are narrower than the
 * request — and a feature that then fails with a raw 403 from Shopify looks
 * like our bug. Comparing at connect time lets us say so plainly instead.
 */
export function missingScopes(granted: string): string[] {
  const have = new Set(granted.split(",").map((s) => s.trim()).filter(Boolean));
  return SCOPES.filter((scope) => !have.has(scope));
}
