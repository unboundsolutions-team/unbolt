import { isIP } from "node:net";

/**
 * Validating a URL that a stranger asked our server to fetch.
 *
 * ── The vulnerability this exists to close ──────────────────────────
 * `/tools/store-health-scan` is a public, no-account form. Whatever a visitor
 * types goes to a background worker which then makes an HTTP request *from
 * inside our infrastructure*. That is a server-side request forgery primitive
 * handed to the internet, and it is the single most dangerous thing in M5.
 *
 * What an attacker reaches with it if unchecked:
 *
 *  - `http://169.254.169.254/latest/meta-data/iam/...` — cloud instance
 *    metadata, which on several providers returns credentials.
 *  - `http://localhost:*` — anything bound to loopback on the function host.
 *  - `http://10.0.0.0/8`, `172.16/12`, `192.168/16` — internal services that
 *    are unauthenticated precisely *because* they are not routable.
 *  - `file://`, `gopher://` — non-HTTP schemes with their own surprises.
 *
 * A blocklist of hostnames does not work, because `localhost`, `127.0.0.1`,
 * `127.1`, `0177.0.0.1`, `[::1]`, `2130706433` and a DNS name that simply
 * *resolves* to loopback are all the same destination. So this module allows
 * only what it understands, and the caller re-checks after DNS resolution —
 * see {@link assertPublicAddress} and the note on DNS rebinding.
 */

export class UnsafeTargetError extends Error {
  constructor(
    message: string,
    readonly publicMessage = "That address can't be scanned.",
  ) {
    super(message);
    this.name = "UnsafeTargetError";
  }
}

/**
 * Normalise what a visitor typed into an origin we are willing to fetch.
 *
 * Deliberately forgiving about form — a merchant pasting `northline.co` or
 * `www.northline.co/collections/all` should both work — and completely
 * unforgiving about destination.
 */
export function parseScanTarget(raw: string | null | undefined): URL {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new UnsafeTargetError("No URL supplied.", "Enter your store's web address.");
  }

  const trimmed = raw.trim();
  if (trimmed.length > 2000) {
    throw new UnsafeTargetError("URL is absurdly long.", "That address is too long.");
  }

  // Default to https rather than rejecting a bare hostname. Most people type
  // "northline.co".
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new UnsafeTargetError(
      `Unparseable URL: ${trimmed}`,
      "That doesn't look like a web address.",
    );
  }

  // Allowlist, not blocklist. file:, gopher:, ftp:, data: and friends are not
  // "unlikely" — they are the point of an SSRF attempt.
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UnsafeTargetError(
      `Refused scheme ${url.protocol}`,
      "Only http and https addresses can be scanned.",
    );
  }

  // Credentials in a URL are never legitimate here and are a classic way to
  // confuse a parser into disagreeing with a fetcher about the real host.
  if (url.username || url.password) {
    throw new UnsafeTargetError("URL carried credentials.", "Remove the login part of that address.");
  }

  // A non-standard port is a strong signal someone is probing an internal
  // service rather than scanning a storefront, which is always 80 or 443.
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new UnsafeTargetError(
      `Refused port ${url.port}`,
      "We can only scan stores on the standard web ports.",
    );
  }

  const host = url.hostname.toLowerCase();
  if (host.length === 0) throw new UnsafeTargetError("Empty hostname.");

  assertRoutableHostname(host);

  // Rebuild from parsed parts. Nothing downstream ever sees the raw string,
  // so a parser difference between us and the HTTP client cannot be exploited.
  const clean = new URL(`${url.protocol}//${url.hostname}${url.pathname}`);
  clean.hash = "";
  clean.search = "";
  return clean;
}

/**
 * Reject hostnames that cannot possibly be a public storefront.
 *
 * This is the *syntactic* half. It catches literal addresses and obvious
 * internal names. It cannot catch `evil.com` resolving to 10.0.0.1 — only DNS
 * resolution can, which is {@link assertPublicAddress}.
 */
function assertRoutableHostname(host: string): void {
  // Bracketed IPv6 literal, e.g. [::1]
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

  const version = isIP(bare);
  if (version !== 0) {
    assertPublicAddress(bare);
    return;
  }

  // Decimal, octal and hex integer forms of an IPv4 address — `2130706433`,
  // `0177.0.0.1`, `0x7f000001`, `127.1` are all 127.0.0.1.
  //
  // In the normal path these never reach here: Node's WHATWG URL parser already
  // canonicalises them to a dotted quad, so the isIP branch above catches them.
  // This is kept as defence in depth for any caller that hands us a raw
  // hostname without going through URL parsing first, and because relying on an
  // undocumented normalisation for a security check is how it breaks quietly on
  // a runtime upgrade.
  if (/^(0x[0-9a-f]+|\d+)$/i.test(host)) {
    throw new UnsafeTargetError(
      `Numeric host form: ${host}`,
      "That doesn't look like a store address.",
    );
  }

  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new UnsafeTargetError("Loopback name.", "That address can't be scanned.");
  }

  // Names that only resolve inside a network. `.internal` in particular is
  // where several cloud providers put their metadata services.
  if (/\.(local|internal|localdomain|home|lan|corp|intranet)$/.test(host)) {
    throw new UnsafeTargetError(
      `Private TLD: ${host}`,
      "That address is only reachable from a private network.",
    );
  }

  // A public site has a dot. This also rejects single-label intranet hostnames.
  if (!host.includes(".")) {
    throw new UnsafeTargetError(
      `Single-label host: ${host}`,
      "Enter the full address, like your-store.com.",
    );
  }
}

/**
 * Reject an IP that is not on the public internet.
 *
 * Exported because it must be called AGAIN after DNS resolution, immediately
 * before the fetch. Checking only the hostname leaves DNS rebinding wide open:
 * an attacker controls `rebind.evil.com`, answers with a public address for our
 * validation lookup and 127.0.0.1 for the fetch a moment later.
 */
export function assertPublicAddress(address: string): void {
  const version = isIP(address);
  if (version === 4) return assertPublicIpv4(address);
  if (version === 6) return assertPublicIpv6(address.toLowerCase());
  throw new UnsafeTargetError(`Not an IP address: ${address}`);
}

function assertPublicIpv4(address: string): void {
  const parts = address.split(".").map(Number);
  const [a = 0, b = 0] = parts;

  const blocked =
    a === 0 || // 0.0.0.0/8 "this network"
    a === 10 || // private
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local — cloud metadata lives at 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 192 && b === 0) || // 192.0.0.0/24 IETF protocol assignments
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224; // multicast and reserved, including 255.255.255.255

  if (blocked) {
    throw new UnsafeTargetError(
      `Refused non-public IPv4 ${address}`,
      "That address isn't on the public internet.",
    );
  }
}

function assertPublicIpv6(address: string): void {
  const blocked =
    address === "::" ||
    address === "::1" || // loopback
    address.startsWith("fe80") || // link-local
    address.startsWith("fc") || // unique local
    address.startsWith("fd") ||
    address.startsWith("ff") || // multicast
    // IPv4-mapped and IPv4-compatible forms smuggle a v4 address through a v6
    // check that only looks at the prefix.
    address.startsWith("::ffff:") ||
    address.startsWith("::127.") ||
    address.startsWith("64:ff9b::");

  if (blocked) {
    throw new UnsafeTargetError(
      `Refused non-public IPv6 ${address}`,
      "That address isn't on the public internet.",
    );
  }

  // An IPv4-mapped address that survived the prefix check still has to have its
  // embedded v4 address vetted.
  const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mapped?.[1]) assertPublicIpv4(mapped[1]);
}
