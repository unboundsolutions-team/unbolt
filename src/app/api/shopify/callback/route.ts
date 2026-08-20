import { NextResponse, type NextRequest } from "next/server";

import { shopOrigin, type ShopDomain } from "@/server/shopify/domain";
import { decryptToken } from "@/server/shopify/crypto";
import {
  exchangeCode,
  loadConfig,
  parseCallback,
  ShopifyOAuthError,
  type ShopifyConfig,
} from "@/server/shopify/oauth";
import { consumeOAuthState, recordConnection } from "@/server/shopify/store-service";

export const dynamic = "force-dynamic";

/**
 * Where Shopify sends the merchant after they approve.
 *
 * This handler is the security boundary of the whole integration, because
 * everything about the request is attacker-controllable — anyone can navigate a
 * browser here with any query string they like. The order below is the order it
 * has to be in:
 *
 *  1. `parseCallback` — shop domain is a real store, and the HMAC proves the
 *     parameters came from Shopify and were not edited in transit.
 *  2. `consumeOAuthState` — the state matches a nonce WE minted, is unexpired,
 *     and has not been used. This is what stops an attacker completing an
 *     install into their own workspace, or replaying a captured callback.
 *  3. The nonce's shop must equal the callback's shop — otherwise a valid nonce
 *     for store A could be used to attach store B.
 *  4. Only then is the code exchanged for a token.
 *
 * Skipping any one of those is a real vulnerability, not a code-quality note.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  let config: ShopifyConfig;
  try {
    config = loadConfig();
  } catch (error) {
    return failure(request, error);
  }

  let callback;
  try {
    callback = parseCallback(params, config);
  } catch (error) {
    return failure(request, error);
  }

  const claimed = await consumeOAuthState(callback.state);
  if (!claimed) {
    // Unknown, expired, or already used. All three mean the same thing to the
    // merchant and we deliberately do not say which — telling an attacker that
    // a nonce *existed* but was consumed is free information.
    return failure(
      request,
      new ShopifyOAuthError(
        `No live OAuth state for callback from ${callback.shop}.`,
        "That connection link has expired or was already used. Start again from your dashboard.",
      ),
    );
  }

  if (claimed.shop !== callback.shop) {
    return failure(
      request,
      new ShopifyOAuthError(
        `State was minted for ${claimed.shop} but the callback claims ${callback.shop}.`,
        "That connection didn't match the store it started from. Try again.",
      ),
    );
  }

  let granted;
  try {
    granted = await exchangeCode({ config, shop: callback.shop, code: callback.code });
  } catch (error) {
    return failure(request, error);
  }

  let profile;
  try {
    profile = await fetchShopProfile(callback.shop, granted.accessToken);
  } catch (error) {
    // A profile is decoration — the store name and plan on a card. Losing it
    // must not lose the connection the merchant just approved.
    console.warn("[shopify callback] profile fetch failed", error);
    profile = {};
  }

  try {
    const { storeId, missingScopes } = await recordConnection({
      organizationId: claimed.organizationId,
      userId: claimed.userId,
      shop: callback.shop,
      accessToken: granted.accessToken,
      scope: granted.scope,
      profile,
    });

    // Read it straight back. If the encryption key is misconfigured, this is
    // the moment to find out — not weeks later when a feature needs the token
    // and finds an undecryptable value with no way to recover it.
    await assertRecoverable(storeId);

    const url = new URL(claimed.returnTo ?? "/app/stores", request.nextUrl.origin);
    url.searchParams.set("connected", callback.shop);
    if (missingScopes.length > 0) url.searchParams.set("partial", missingScopes.join(","));
    return NextResponse.redirect(url);
  } catch (error) {
    return failure(request, error);
  }
}

/**
 * The shop's own details, for display.
 *
 * Uses the token we were just given, against the store's own origin built from
 * the parsed domain — never from anything in the request.
 */
async function fetchShopProfile(
  shop: ShopDomain,
  accessToken: string,
): Promise<{ name?: string; email?: string; planName?: string; currency?: string }> {
  const response = await fetch(`${shopOrigin(shop)}/admin/api/2025-01/shop.json`, {
    headers: { "X-Shopify-Access-Token": accessToken, Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) return {};

  const body = (await response.json()) as {
    shop?: { name?: string; email?: string; plan_display_name?: string; currency?: string };
  };
  const shopBody = body.shop ?? {};

  return {
    ...(shopBody.name ? { name: shopBody.name } : {}),
    ...(shopBody.email ? { email: shopBody.email } : {}),
    ...(shopBody.plan_display_name ? { planName: shopBody.plan_display_name } : {}),
    ...(shopBody.currency ? { currency: shopBody.currency } : {}),
  };
}

/** Prove the stored ciphertext decrypts before telling the merchant it worked. */
async function assertRecoverable(storeId: string): Promise<void> {
  const { db } = await import("@/db/client");
  const { stores } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");

  const [row] = await db
    .select({ token: stores.accessTokenEncrypted })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);

  if (!row?.token) throw new ShopifyOAuthError("Stored connection carries no token.");
  decryptToken(row.token); // throws if the envelope or key is wrong
}

/**
 * Send the merchant somewhere with a sentence, and put the detail in the log.
 *
 * Errors here must never render Shopify's response body or our own diagnostics
 * to the browser: the messages reference secrets, and the difference between
 * "no such nonce" and "nonce already used" is information an attacker can use.
 */
function failure(request: NextRequest, error: unknown): NextResponse {
  const known = error instanceof ShopifyOAuthError;
  console.error("[shopify callback]", known ? error.message : error);

  const url = new URL("/app/stores", request.nextUrl.origin);
  url.searchParams.set(
    "error",
    known ? error.publicMessage : "That store could not be connected. Try again.",
  );
  return NextResponse.redirect(url);
}
