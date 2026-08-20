import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware.
 *
 * ── What this deliberately does NOT do ──────────────────────────────
 * It runs on Deno at the edge with no database and no Node APIs (§6 of the
 * brief), so it cannot verify a session, look up a membership or evaluate a
 * role. Treating a cookie's *presence* as authentication would be a real
 * vulnerability — anyone can set a cookie.
 *
 * So this is a routing and headers concern only. It gets an unauthenticated
 * visitor off a portal URL quickly, and keeps a signed-in one off the sign-in
 * page. The actual authorization happens in src/server/auth-context.ts, which
 * re-derives everything from the database on the server. A forged cookie gets
 * past middleware and then bounces off the real check.
 */

/** Better Auth's session cookie, given the `unbolt` prefix set in auth.ts. */
const SESSION_COOKIE = "unbolt.session_token";

const PROTECTED = ["/app", "/admin", "/welcome"];
const AUTH_ROUTES = ["/login", "/register"];

function hasSessionCookie(request: NextRequest): boolean {
  return (
    request.cookies.has(SESSION_COOKIE) ||
    // Secure cookies are prefixed in production.
    request.cookies.has(`__Secure-${SESSION_COOKIE}`)
  );
}

/**
 * Routes Next.js prerenders to static HTML at build time.
 *
 * ── Why this list has to exist ──────────────────────────────────────
 * A nonce is per-response. Prerendered HTML is written once at build time and
 * served from the CDN to everyone, so the nonce in the header can never match
 * anything in the body. Combined with 'strict-dynamic' — which makes the browser
 * IGNORE 'self' and honour only the nonce — the result is that every script on
 * every cached page is refused and the site is a static picture of itself.
 *
 * That is not a theoretical concern: it is exactly what the first production
 * build did, and nothing short of running one would have shown it. The
 * report-only policy used in development reported nothing, because in
 * development nothing is prerendered.
 *
 * So these routes get a policy that matches what is actually in their HTML, and
 * every other route — everything that can contain request-derived data — gets
 * the nonce.
 *
 * ── Keeping it honest ───────────────────────────────────────────────
 * A stale entry here is a blank page in production. tests/csp-routes.test.ts
 * reads Next's own prerender manifest and fails if this list and reality have
 * drifted, so adding a page cannot quietly break the policy.
 */
const PRERENDERED = new Set([
  "/_not-found",
  "/components",
  "/how-it-works",
  "/icon.svg",
  "/legal/privacy",
  "/legal/terms",
  "/login",
  "/register",
  "/robots.txt",
  "/security",
  "/services",
  "/sitemap.xml",
  "/tools/store-health-scan",
]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const signedIn = hasSessionCookie(request);

  if (PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`)) && !signedIn) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return withSecurityHeaders(NextResponse.redirect(url), pathname);
  }

  // Signed in and standing on the sign-in page: send them to the portal.
  //
  // /app may itself redirect to /welcome when the user has no organisation yet
  // — that decision needs the database, so it can only be made on the server.
  // /welcome is therefore in PROTECTED rather than AUTH_ROUTES: bouncing it
  // back to /app here would rebuild the registration loop this exists to break.
  if (AUTH_ROUTES.includes(pathname) && signedIn) {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    url.search = "";
    return withSecurityHeaders(NextResponse.redirect(url), pathname);
  }

  return withSecurityHeaders(null, pathname, request);
}

/** Everything in the policy that does not depend on how the page is rendered. */
function baseDirectives(isProduction: boolean): string[] {
  return [
    // Tailwind emits no inline styles, but Next's dev overlay does.
    "style-src 'self' 'unsafe-inline'",
    // Fonts are self-hosted (src/app/fonts.ts) — no third-party origin needed.
    "font-src 'self'",
    "img-src 'self' data: blob: https://cdn.shopify.com",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(isProduction ? ["upgrade-insecure-requests"] : []),
  ];
}

/**
 * Security headers, with the script policy chosen to match how the page is
 * actually rendered.
 *
 * `netlify.toml` carries the static headers that never change; this carries the
 * one that has to be decided per response. Report-only outside production so a
 * policy mistake surfaces in the console rather than breaking a page — with the
 * caveat, learned the hard way, that report-only in development proves very
 * little about production.
 */
function withSecurityHeaders(
  redirect: NextResponse | null,
  pathname: string,
  request?: NextRequest,
): NextResponse {
  const isProduction = process.env["NEXT_PUBLIC_APP_ENV"] === "production";
  const prerendered = PRERENDERED.has(pathname);
  const nonce = prerendered ? null : crypto.randomUUID().replaceAll("-", "");

  const script = nonce
    ? // 'strict-dynamic' lets Next's nonced bootstrap load its own chunks
      // without every hashed filename needing to be in the policy. It also
      // voids 'self', which is the whole reason the prerendered branch below
      // cannot use it.
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProduction ? "" : " 'unsafe-eval'"}`
    : // Build-time HTML. Every byte of it comes from this repository and is
      // identical for every visitor, so there is no injection point for
      // 'unsafe-inline' to protect: the inline scripts here are Next's own
      // bootstrap payload, fixed at build time. 'self' still confines loaded
      // scripts to our origin, and the directives that actually stop the
      // common attacks — object-src, base-uri, form-action, frame-ancestors —
      // are unchanged.
      `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`;

  const csp = ["default-src 'self'", script, ...baseDirectives(isProduction)].join("; ");

  const header = isProduction ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";

  // A redirect renders nothing, so there is no document to stamp a nonce into.
  if (redirect) {
    redirect.headers.set(header, csp);
    return redirect;
  }

  // ── The part that was missing ─────────────────────────────────────
  // Next stamps the nonce onto its own script tags only if it finds it on the
  // INCOMING request. Setting it on the response alone produces a policy that
  // names a nonce no script carries — which looks completely correct in the
  // response headers and blocks the entire page.
  const requestHeaders = new Headers(request?.headers);
  if (nonce) {
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("content-security-policy", csp);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  if (nonce) response.headers.set("x-nonce", nonce);
  response.headers.set(header, csp);
  return response;
}

export const config = {
  /**
   * Skip static assets and the auth endpoints. Better Auth's own routes set
   * their own cookies and must not be redirected by the rules above.
   */
  matcher: ["/((?!_next/static|_next/image|api/auth|favicon.ico|icon.svg|fonts).*)"],
};
