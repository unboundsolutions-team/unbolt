/**
 * Shop domain validation.
 *
 * ── Why this file exists at all ─────────────────────────────────────
 * Every Shopify OAuth flow starts with a shop domain that arrived from the
 * browser, and the app then *redirects the merchant to it* and later *sends an
 * API token to it*. That makes this string the single most dangerous input in
 * the integration. If `evil.com` gets through, we have built a redirector that
 * hands attackers an access token.
 *
 * The check that looks right and is not:
 *
 *   shop.endsWith(".myshopify.com")     // "evil.com/x.myshopify.com" ✗
 *   shop.includes(".myshopify.com")     // "x.myshopify.com.evil.com" ✗
 *
 * Both are real, repeatedly-exploited mistakes in published Shopify apps. So
 * this module allows exactly one shape and rejects everything else, and it is
 * the ONLY place a shop domain may be turned into something trusted.
 */

/**
 * `acme-store.myshopify.com`
 *
 * Anchored at both ends. One label before `.myshopify.com`, alphanumeric with
 * internal hyphens, no dots — a dot would allow `a.b.myshopify.com`, which is
 * not a store and may be someone else's subdomain.
 */
const SHOP_PATTERN = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]\.myshopify\.com$/;

/** A shop domain that has been through {@link parseShopDomain}. */
export type ShopDomain = string & { readonly __shop: unique symbol };

/**
 * Normalise and validate. Returns null rather than throwing so callers are
 * forced to handle the rejection — an exception here is too easy to swallow.
 *
 * Accepts what a merchant might reasonably paste (a full URL, trailing slash,
 * uppercase, whitespace) and normalises it, because refusing
 * `https://Acme.myshopify.com/admin` on a technicality just costs a signup.
 * What it will not do is accept a host that is not a store.
 */
export function parseShopDomain(raw: string | null | undefined): ShopDomain | null {
  if (typeof raw !== "string") return null;

  let value = raw.trim().toLowerCase();
  if (value.length === 0 || value.length > 255) return null;

  // A pasted admin URL. Strip the scheme and anything after the host.
  if (value.includes("://")) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    // Only http(s). `javascript:` and friends have no business here.
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    // A userinfo section is how "https://acme.myshopify.com@evil.com" pretends
    // to be a store. URL parsing puts the real host in `hostname`, but the
    // presence of userinfo at all means someone is trying something.
    if (url.username || url.password) return null;
    value = url.hostname;
  } else {
    // Bare host with a path or query, e.g. "acme.myshopify.com/admin".
    const cut = value.search(/[/?#]/);
    if (cut !== -1) value = value.slice(0, cut);
    // A bare "host:port" is not a shop domain.
    if (value.includes(":")) return null;
  }

  // Trailing dot is a legal FQDN form and would slip past a naive suffix check.
  if (value.endsWith(".")) value = value.slice(0, -1);

  if (!SHOP_PATTERN.test(value)) return null;
  return value as ShopDomain;
}

/** True only for a string this module would accept. */
export function isShopDomain(raw: string | null | undefined): raw is ShopDomain {
  return parseShopDomain(raw) !== null;
}

/**
 * The store's admin API origin.
 *
 * Built from a parsed domain rather than from raw input, so there is no path
 * from a request body to a URL we call with a token attached.
 */
export function shopOrigin(shop: ShopDomain): string {
  return `https://${shop}`;
}

/** "acme-store.myshopify.com" → "acme-store". For display only. */
export function shopHandle(shop: ShopDomain): string {
  return shop.replace(/\.myshopify\.com$/, "");
}
