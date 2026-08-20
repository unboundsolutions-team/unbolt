import { lookup } from "node:dns/promises";

import { assertPublicAddress, UnsafeTargetError } from "./target";
import type { ScanMetrics } from "./findings";

/**
 * Where the numbers come from.
 *
 * Behind an interface for two reasons. The honest one: there is no PageSpeed
 * API key yet, so the pipeline has to be provable without one. The better one:
 * the audit source is a vendor choice, and a vendor choice that is hardcoded
 * into a worker is a rewrite when it changes.
 */

export interface AuditResult {
  performanceScore?: number | undefined;
  accessibilityScore?: number | undefined;
  seoScore?: number | undefined;
  bestPracticesScore?: number | undefined;
  metrics: ScanMetrics;
}

export interface AuditProvider {
  readonly name: string;
  run(target: URL): Promise<AuditResult>;
}

export class AuditUnavailableError extends Error {
  constructor(
    message: string,
    readonly publicMessage = "We couldn't reach that store. Check the address and try again.",
  ) {
    super(message);
    this.name = "AuditUnavailableError";
  }
}

/**
 * Re-check the destination after DNS, immediately before any request.
 *
 * This is the half of SSRF defence that hostname validation cannot do. An
 * attacker who controls `rebind.evil.com` can answer our validation lookup with
 * a public address and the fetch a moment later with 127.0.0.1. Resolving here
 * and refusing a private answer closes the window to the gap between this call
 * and the request — which is not zero, but is no longer "whatever DNS says".
 *
 * Every address is checked, not just the first: a hostile resolver can return
 * one public A record and one private one and let the client pick.
 */
export async function assertResolvesPublic(hostname: string): Promise<void> {
  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new AuditUnavailableError(
      `DNS lookup failed for ${hostname}`,
      "We couldn't find that address. Check the spelling and try again.",
    );
  }

  if (addresses.length === 0) {
    throw new UnsafeTargetError(`No addresses for ${hostname}`, "We couldn't find that address.");
  }

  for (const { address } of addresses) assertPublicAddress(address);
}

/**
 * Google PageSpeed Insights.
 *
 * Chosen because it returns Chrome field data where it exists — real numbers
 * from real shoppers rather than a lab run on a machine nobody shops from. The
 * scan page promises exactly that, so the provider has to be able to deliver it.
 */
export class PageSpeedProvider implements AuditProvider {
  readonly name = "pagespeed";

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async run(target: URL): Promise<AuditResult> {
    await assertResolvesPublic(target.hostname);

    const endpoint = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
    endpoint.searchParams.set("url", target.toString());
    endpoint.searchParams.set("strategy", "mobile");
    endpoint.searchParams.set("key", this.apiKey);
    for (const category of ["performance", "accessibility", "seo", "best-practices"]) {
      endpoint.searchParams.append("category", category);
    }

    const response = await this.fetchImpl(endpoint.toString(), {
      // Well inside the 15-minute background function ceiling, but bounded so
      // one hung request cannot hold a worker slot open indefinitely.
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) {
      throw new AuditUnavailableError(
        `PageSpeed returned ${response.status} for ${target}`,
        response.status === 429
          ? "We're running a lot of scans right now. Try again in a few minutes."
          : "We couldn't analyse that page. It may be password-protected or blocking automated traffic.",
      );
    }

    return parsePageSpeed(await response.json());
  }
}

/**
 * PageSpeed's response shape, defensively.
 *
 * Every field is optional in practice: audits get renamed, field data is absent
 * for low-traffic stores, and a category can be missing entirely. A parser that
 * assumes structure here fails on exactly the stores that most need scanning.
 */
export function parsePageSpeed(payload: unknown): AuditResult {
  const root = payload as {
    lighthouseResult?: {
      categories?: Record<string, { score?: number } | undefined>;
      audits?: Record<string, { numericValue?: number; details?: unknown } | undefined>;
    };
    loadingExperience?: {
      metrics?: Record<string, { percentile?: number } | undefined>;
    };
  };

  const categories = root.lighthouseResult?.categories ?? {};
  const audits = root.lighthouseResult?.audits ?? {};
  const field = root.loadingExperience?.metrics ?? {};

  const metrics: ScanMetrics = {};

  // Field data first where it exists — real shoppers beat a lab run.
  const fieldLcp = field["LARGEST_CONTENTFUL_PAINT_MS"]?.percentile;
  const labLcp = audits["largest-contentful-paint"]?.numericValue;
  if (fieldLcp !== undefined || labLcp !== undefined) metrics.lcp = fieldLcp ?? labLcp;

  const fieldCls = field["CUMULATIVE_LAYOUT_SHIFT_SCORE"]?.percentile;
  const labCls = audits["cumulative-layout-shift"]?.numericValue;
  // The field API reports CLS multiplied by 100 and integer-encoded.
  if (fieldCls !== undefined) metrics.cls = fieldCls / 100;
  else if (labCls !== undefined) metrics.cls = labCls;

  const fieldInp = field["INTERACTION_TO_NEXT_PAINT"]?.percentile;
  if (fieldInp !== undefined) metrics.inp = fieldInp;

  const tbt = audits["total-blocking-time"]?.numericValue;
  if (tbt !== undefined) metrics.tbt = tbt;

  const renderBlocking = itemCount(audits["render-blocking-resources"]?.details);
  if (renderBlocking !== undefined) metrics.renderBlocking = renderBlocking;

  const thirdParties = itemCount(audits["third-party-summary"]?.details);
  if (thirdParties !== undefined) metrics.thirdParties = thirdParties;

  const byType = resourceBytes(audits["resource-summary"]?.details);
  if (byType.script !== undefined) metrics.jsBytes = byType.script;
  if (byType.image !== undefined) metrics.imageBytes = byType.image;

  return {
    ...score(categories["performance"]?.score, "performanceScore"),
    ...score(categories["accessibility"]?.score, "accessibilityScore"),
    ...score(categories["seo"]?.score, "seoScore"),
    ...score(categories["best-practices"]?.score, "bestPracticesScore"),
    metrics,
  };
}

/** Lighthouse scores are 0–1; ours are 0–100 and must satisfy a CHECK constraint. */
function score<K extends string>(value: number | undefined, key: K): Partial<Record<K, number>> {
  if (typeof value !== "number" || Number.isNaN(value)) return {};
  const scaled = Math.round(value * 100);
  return { [key]: Math.min(100, Math.max(0, scaled)) } as Partial<Record<K, number>>;
}

function itemCount(details: unknown): number | undefined {
  const items = (details as { items?: unknown[] } | undefined)?.items;
  return Array.isArray(items) ? items.length : undefined;
}

function resourceBytes(details: unknown): { script?: number; image?: number } {
  const items = (details as { items?: { resourceType?: string; transferSize?: number }[] } | undefined)
    ?.items;
  if (!Array.isArray(items)) return {};

  const out: { script?: number; image?: number } = {};
  for (const item of items) {
    if (item.resourceType === "script" && typeof item.transferSize === "number") {
      out.script = item.transferSize;
    }
    if (item.resourceType === "image" && typeof item.transferSize === "number") {
      out.image = item.transferSize;
    }
  }
  return out;
}

/**
 * The provider used when no PageSpeed key is configured.
 *
 * It does NOT fabricate a report. It fetches the page for real — which proves
 * the SSRF guards, the DNS re-check, the job lifecycle and the polling UI all
 * work — and then refuses to produce scores it has no basis for.
 *
 * A fake that invents plausible numbers would make the scan look finished in
 * every environment and hide a missing key until a customer saw invented data.
 */
export class UnconfiguredProvider implements AuditProvider {
  readonly name = "unconfigured";

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async run(target: URL): Promise<AuditResult> {
    await assertResolvesPublic(target.hostname);

    // Prove the target is a real, reachable storefront before failing, so a
    // typo is reported as a typo rather than as a missing API key.
    const response = await this.fetchImpl(target.toString(), {
      method: "GET",
      redirect: "follow",
      headers: { "User-Agent": "UnboltStoreHealthScan/1.0 (+https://unbolt.unboundsolutions.in)" },
      signal: AbortSignal.timeout(15_000),
    }).catch((error: unknown) => {
      throw new AuditUnavailableError(
        `Could not reach ${target}: ${String(error)}`,
        "We couldn't reach that store. Check the address and try again.",
      );
    });

    if (!response.ok) {
      throw new AuditUnavailableError(
        `${target} returned ${response.status}`,
        "That page didn't load for us. It may be password-protected.",
      );
    }

    throw new AuditUnavailableError(
      "PAGESPEED_API_KEY is not configured, so no audit was run.",
      "Our scanner is being set up. We reached your store fine — try again shortly.",
    );
  }
}

export function loadProvider(env = process.env, fetchImpl: typeof fetch = fetch): AuditProvider {
  const key = env["PAGESPEED_API_KEY"];
  return key ? new PageSpeedProvider(key, fetchImpl) : new UnconfiguredProvider(fetchImpl);
}
