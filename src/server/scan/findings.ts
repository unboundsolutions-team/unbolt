/**
 * Turning raw audit numbers into a ranked list of what to fix.
 *
 * ── The product decision this file encodes ──────────────────────────
 * §1 of the brief: the competitor's tools list problems. Ours has to produce
 * "a list ordered by what would move revenue first" — that is the promise the
 * scan page makes in writing, and this is the only place it can be kept.
 *
 * So findings are not sorted by score, or by how bad the number is. They are
 * sorted by estimated commercial impact on a storefront, which is a judgement
 * about ecommerce, not about Lighthouse.
 *
 * §10.4 also blocks us from asserting statistics we cannot defend. So nothing
 * here says "this costs you 7% of revenue". Findings describe what is
 * measurably true and rank it; they never invent a number.
 */

export interface ScanMetrics {
  /** Largest Contentful Paint, ms. */
  lcp?: number | undefined;
  /** Cumulative Layout Shift, unitless. */
  cls?: number | undefined;
  /** Interaction to Next Paint, ms. */
  inp?: number | undefined;
  /** Total Blocking Time, ms. */
  tbt?: number | undefined;
  /** Bytes of JavaScript on the scanned page. */
  jsBytes?: number | undefined;
  /** Bytes of images. */
  imageBytes?: number | undefined;
  /** Count of render-blocking resources. */
  renderBlocking?: number | undefined;
  /** Count of third-party script origins. */
  thirdParties?: number | undefined;
}

export type Severity = "critical" | "high" | "medium" | "low";

export interface Finding {
  id: string;
  title: string;
  /** Written to the merchant, in their vocabulary, not Lighthouse's. */
  body: string;
  severity: Severity;
  /** What we measured, formatted for display. Never a projection. */
  evidence: string;
  /** Higher runs first. Commercial impact, not metric badness. */
  rank: number;
}

/**
 * Thresholds are Google's published Core Web Vitals boundaries, not ours.
 * Using someone else's public standard means the numbers are defensible and we
 * are not quietly grading on a curve that flatters a sales pitch.
 */
const LCP_POOR = 4000;
const LCP_NEEDS_WORK = 2500;
const CLS_POOR = 0.25;
const CLS_NEEDS_WORK = 0.1;
const INP_POOR = 500;
const INP_NEEDS_WORK = 200;

export function buildFindings(metrics: ScanMetrics): Finding[] {
  const findings: Finding[] = [];

  // LCP first, always. It is the closest proxy we have to "did the shopper see
  // the product before deciding to leave", which is the thing that costs money.
  if (metrics.lcp !== undefined) {
    if (metrics.lcp >= LCP_POOR) {
      findings.push({
        id: "lcp-poor",
        title: "Your main product image takes too long to appear",
        body:
          "The biggest thing on the page finishes loading well after a shopper has decided " +
          "whether to stay. This is usually an oversized hero image, a slow theme section, or " +
          "a font that blocks the first paint.",
        severity: "critical",
        evidence: `Largest Contentful Paint ${fmtMs(metrics.lcp)} (Google considers over 4s poor)`,
        rank: 100,
      });
    } else if (metrics.lcp >= LCP_NEEDS_WORK) {
      findings.push({
        id: "lcp-slow",
        title: "The page is slower to show its main content than it should be",
        body:
          "Not alarming, but above the point where Google stops counting a page as fast — " +
          "which affects both how it ranks and how it feels on a phone on mobile data.",
        severity: "high",
        evidence: `Largest Contentful Paint ${fmtMs(metrics.lcp)} (target is under 2.5s)`,
        rank: 80,
      });
    }
  }

  // CLS ranks above raw speed: a layout that jumps makes people tap the wrong
  // thing at exactly the moment they are trying to buy.
  if (metrics.cls !== undefined && metrics.cls >= CLS_NEEDS_WORK) {
    findings.push({
      id: metrics.cls >= CLS_POOR ? "cls-poor" : "cls-slow",
      title: "The page moves around while it loads",
      body:
        "Content shifts after it appears, so a shopper reaching for 'Add to cart' can land on " +
        "something else. Usually images without dimensions, or an app banner injected late.",
      severity: metrics.cls >= CLS_POOR ? "critical" : "high",
      evidence: `Cumulative Layout Shift ${metrics.cls.toFixed(3)} (target is under 0.1)`,
      rank: metrics.cls >= CLS_POOR ? 95 : 78,
    });
  }

  if (metrics.inp !== undefined && metrics.inp >= INP_NEEDS_WORK) {
    findings.push({
      id: "inp",
      title: "Taps and clicks feel laggy",
      body:
        "The page takes a visible moment to respond after a shopper interacts with it. On a " +
        "product page that is the variant picker and the add-to-cart button.",
      severity: metrics.inp >= INP_POOR ? "high" : "medium",
      evidence: `Interaction to Next Paint ${fmtMs(metrics.inp)} (target is under 200ms)`,
      rank: metrics.inp >= INP_POOR ? 75 : 55,
    });
  }

  // Third-party scripts are ranked high because they are the finding a merchant
  // can act on *today* without a developer — usually by deleting an app they
  // stopped using a year ago.
  if (metrics.thirdParties !== undefined && metrics.thirdParties >= 8) {
    findings.push({
      id: "third-parties",
      title: `${metrics.thirdParties} third-party scripts are running on this page`,
      body:
        "Each one is an app, pixel or widget loading code from someone else's server. Stores " +
        "usually keep paying for several they no longer use, and every one of them competes " +
        "with your own page for the phone's attention.",
      severity: metrics.thirdParties >= 15 ? "high" : "medium",
      evidence: `${metrics.thirdParties} distinct third-party origins`,
      rank: 70,
    });
  }

  if (metrics.jsBytes !== undefined && metrics.jsBytes > 500_000) {
    findings.push({
      id: "js-weight",
      title: "There is a lot of JavaScript to download before the page works",
      body:
        "Large scripts have to arrive, parse and run before anything is interactive. This is " +
        "the single most common cost of apps installed and never removed.",
      severity: metrics.jsBytes > 1_500_000 ? "high" : "medium",
      evidence: `${fmtBytes(metrics.jsBytes)} of JavaScript`,
      rank: 60,
    });
  }

  if (metrics.imageBytes !== undefined && metrics.imageBytes > 2_000_000) {
    findings.push({
      id: "image-weight",
      title: "Images are heavier than they need to be",
      body:
        "Shopify can serve modern formats at the right size automatically. Uploading full " +
        "resolution photographs and letting the browser shrink them wastes most of the download.",
      severity: "medium",
      evidence: `${fmtBytes(metrics.imageBytes)} of images on one page`,
      rank: 50,
    });
  }

  if (metrics.renderBlocking !== undefined && metrics.renderBlocking > 2) {
    findings.push({
      id: "render-blocking",
      title: "Some files stop the page from drawing until they finish",
      body:
        "Stylesheets and scripts in the page head hold up the first paint. Deferring the ones " +
        "that are not needed immediately is usually a same-day fix.",
      severity: "medium",
      evidence: `${metrics.renderBlocking} render-blocking resources`,
      rank: 45,
    });
  }

  // Highest commercial impact first; stable tiebreak so the same input always
  // produces the same report.
  return findings.sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));
}

/**
 * A sentence for a scan that found nothing.
 *
 * Deliberately not celebratory. "Nothing to fix" from a tool that wants to sell
 * you engineering work reads as either broken or dishonest, so it says what was
 * actually checked and what it could not see.
 */
export const CLEAN_RESULT =
  "Nothing on this page crossed the thresholds we check. That covers loading, layout " +
  "stability and script weight on this one URL — not checkout, not your other templates.";

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.round(bytes / 1000)} KB`;
}
