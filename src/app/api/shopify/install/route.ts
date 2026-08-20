import { NextResponse, type NextRequest } from "next/server";

import { getAuthContext } from "@/server/auth-context";
import { can } from "@/server/rbac";
import { parseShopDomain } from "@/server/shopify/domain";
import { authorizeUrl, generateState, loadConfig, ShopifyOAuthError } from "@/server/shopify/oauth";
import { createOAuthState } from "@/server/shopify/store-service";

export const dynamic = "force-dynamic";

/**
 * Start a store connection.
 *
 * GET, because it ends in a redirect the merchant follows to Shopify. That
 * makes it reachable by anything that can make the browser navigate, so it does
 * three things before redirecting anywhere:
 *
 *  1. **Requires a session and the `store:connect` permission.** Otherwise this
 *     is an open endpoint that mints CSRF nonces attached to whichever
 *     organisation happens to be signed in.
 *  2. **Validates the shop domain.** This is the input that becomes a redirect
 *     target; see server/shopify/domain.ts for the attacks that stops.
 *  3. **Binds the nonce to the organisation and user**, so the callback can
 *     prove which workspace a connection belongs to rather than trusting a
 *     parameter.
 */
export async function GET(request: NextRequest) {
  const ctx = await getAuthContext();
  if (!ctx) {
    // Not an API error — a person clicked a link. Send them to sign in and
    // bring them back.
    const next = `/app/stores${request.nextUrl.search}`;
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent(next)}`, request.nextUrl.origin),
    );
  }

  if (!can(ctx.role, "store:connect")) {
    return redirectToStores(request, "forbidden");
  }

  const shop = parseShopDomain(request.nextUrl.searchParams.get("shop"));
  if (!shop) {
    return redirectToStores(request, "bad-shop");
  }

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    console.error("[shopify install]", error);
    return redirectToStores(request, "not-configured");
  }

  const state = generateState();

  try {
    await createOAuthState({
      state,
      shop,
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      // Only a same-origin path is ever stored, so the callback's final
      // redirect cannot be aimed off-site by a query parameter.
      returnTo: safeReturnTo(request.nextUrl.searchParams.get("return_to")),
    });
  } catch (error) {
    console.error("[shopify install] could not persist state", error);
    return redirectToStores(request, "try-again");
  }

  try {
    return NextResponse.redirect(authorizeUrl({ config, shop, state }));
  } catch (error) {
    const message = error instanceof ShopifyOAuthError ? error.message : String(error);
    console.error("[shopify install]", message);
    return redirectToStores(request, "try-again");
  }
}

/**
 * Accept only an absolute same-origin path.
 *
 * Same rule as `safeNext()` on the sign-in form: `//evil.com` is a
 * protocol-relative URL that browsers treat as another origin, and a bare
 * `https://evil.com` is obvious. Both must be refused rather than sanitised.
 */
function safeReturnTo(raw: string | null): string | undefined {
  if (!raw) return undefined;
  if (!raw.startsWith("/") || raw.startsWith("//")) return undefined;
  return raw;
}

function redirectToStores(request: NextRequest, reason: string): NextResponse {
  const url = new URL("/app/stores", request.nextUrl.origin);
  url.searchParams.set("error", reason);
  return NextResponse.redirect(url);
}
