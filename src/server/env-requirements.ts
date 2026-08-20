/**
 * What this app needs from its environment, and what happens without it.
 *
 * ── Why this is data and not a README ───────────────────────────────
 * `.env.example` had drifted in both directions: it documented Upstash Redis,
 * Sentry and PostHog, none of which anything reads, and it omitted
 * NEXT_PUBLIC_APP_ENV, which decides whether the security policy is enforced.
 * A stale example file is worse than none — it is how somebody comes to believe
 * they have configured something they have not.
 *
 * So the list lives here, once. `scripts/preflight.ts` checks a real
 * environment against it before a deploy, and an integration test checks it
 * against the source, so a variable that is added to the code and not to this
 * list fails the build rather than surfacing as a 500 in production.
 *
 * ── Severity is about consequence, not about tidiness ───────────────
 * The distinction that matters is whether the thing fails loudly, fails
 * quietly, or degrades in a way a customer can understand. Only the first kind
 * should stop a deploy.
 */

export type Severity =
  /** The app will not start, or starts insecure. Do not deploy. */
  | "blocker"
  /** The app runs; one feature is broken for anyone who reaches it. */
  | "feature"
  /** The app runs and says honestly that the feature is unconfigured. */
  | "degraded"
  /** Optional. Absence is a normal, supported state. */
  | "optional";

export interface Requirement {
  key: string;
  severity: Severity;
  /** What actually happens when this is missing. Written to be read at 2am. */
  consequence: string;
  /** Only checked when NEXT_PUBLIC_APP_ENV is production. */
  productionOnly?: boolean;
  /** Minimum length, for secrets where a short value is as bad as none. */
  minLength?: number;
  /** Netlify injects it; setting it by hand is the mistake. */
  platformProvided?: boolean;
  /** Must not equal the value of this other key. */
  mustDifferFrom?: string;
}

export const REQUIREMENTS: readonly Requirement[] = [
  {
    key: "NETLIFY_DATABASE_URL",
    severity: "blocker",
    platformProvided: true,
    consequence:
      "Every page that touches the database returns 500. Netlify injects this " +
      "once the Netlify DB extension is enabled on the site — it is not set by " +
      "hand. If it is missing, the extension is not enabled.",
  },
  {
    key: "BETTER_AUTH_SECRET",
    severity: "blocker",
    productionOnly: true,
    minLength: 32,
    mustDifferFrom: "SHOPIFY_TOKEN_KEY",
    consequence:
      "Session tokens are signed with Better Auth's public default secret, " +
      "which makes them forgeable — anyone can mint a session for any account. " +
      "src/lib/auth.ts refuses to start rather than allow this.",
  },
  {
    key: "NEXT_PUBLIC_APP_ENV",
    severity: "blocker",
    productionOnly: true,
    consequence:
      "The Content-Security-Policy is served report-only instead of enforcing, " +
      "and 'unsafe-eval' is allowed. The site works, so nobody notices that the " +
      "policy is doing nothing. This is also what BETTER_AUTH_SECRET's own " +
      "guard keys off, so leaving it unset disables that check too.",
  },
  {
    key: "BETTER_AUTH_URL",
    severity: "feature",
    consequence:
      "Better Auth derives its origin from the incoming request. Sign-in " +
      "callbacks and redirects can land on the wrong host behind a proxy or on " +
      "a branch deploy. Falls back to NEXT_PUBLIC_SITE_URL.",
  },
  {
    key: "NEXT_PUBLIC_SITE_URL",
    severity: "feature",
    consequence:
      "Canonical URLs, the sitemap and Open Graph tags point at the wrong " +
      "origin. Search engines index the deploy-preview host.",
  },
  {
    key: "SHOPIFY_TOKEN_KEY",
    severity: "feature",
    productionOnly: true,
    minLength: 32,
    mustDifferFrom: "BETTER_AUTH_SECRET",
    consequence:
      "Merchant access tokens cannot be encrypted, so connecting a store " +
      "fails. Set it BEFORE the first store connects: changing it afterwards " +
      "makes every stored token undecryptable and every merchant has to " +
      "reinstall.",
  },
  {
    key: "SHOPIFY_API_KEY",
    severity: "feature",
    consequence:
      "The Shopify install flow cannot start. Everything else works; a " +
      "customer clicking Connect store gets an error.",
  },
  {
    key: "SHOPIFY_API_SECRET",
    severity: "feature",
    consequence:
      "OAuth callbacks and webhook HMACs cannot be verified. Without it a " +
      "forged webhook would be indistinguishable from a real one, so the " +
      "handler rejects everything.",
  },
  {
    key: "SHOPIFY_APP_URL",
    severity: "optional",
    consequence:
      "Falls back to BETTER_AUTH_URL. Only needed when the app is reached on a " +
      "different origin than the one Shopify redirects to.",
  },
  {
    key: "PAGESPEED_API_KEY",
    severity: "degraded",
    consequence:
      "The Store Health Scan still reaches the store and confirms it is live, " +
      "then reports that the scanner is being set up. It never invents scores. " +
      "This is a deliberate, honest degradation.",
  },
  {
    key: "STRIPE_SECRET_KEY",
    severity: "degraded",
    consequence:
      "Self-serve checkout is unavailable. The sales-led path is unaffected — " +
      "an admin still provisions accounts and confirms payment by hand.",
  },
  {
    key: "STRIPE_WEBHOOK_SECRET",
    severity: "degraded",
    consequence:
      "The Stripe webhook rejects every delivery, because an unverifiable " +
      "payload is indistinguishable from a forged one. Payments would not " +
      "grant credits. Required only if STRIPE_SECRET_KEY is set.",
  },
] as const;

export interface Finding {
  key: string;
  severity: Severity;
  problem: string;
  consequence: string;
}

/**
 * Check an environment against the list.
 *
 * Takes the environment as an argument rather than reading process.env, so it
 * can be pointed at a Netlify site's variables fetched over the API — which is
 * the case that actually matters, since the deploy does not run here.
 */
export function checkEnvironment(
  env: Record<string, string | undefined>,
  { isProduction }: { isProduction: boolean },
): Finding[] {
  const findings: Finding[] = [];
  const value = (key: string) => env[key]?.trim() ?? "";

  for (const requirement of REQUIREMENTS) {
    if (requirement.productionOnly && !isProduction) continue;

    const present = value(requirement.key);

    if (!present) {
      // Stripe's webhook secret only matters once Stripe is switched on.
      if (requirement.key === "STRIPE_WEBHOOK_SECRET" && !value("STRIPE_SECRET_KEY")) continue;

      findings.push({
        key: requirement.key,
        severity: requirement.severity,
        problem: requirement.platformProvided ? "not injected" : "not set",
        consequence: requirement.consequence,
      });
      continue;
    }

    if (requirement.minLength && present.length < requirement.minLength) {
      findings.push({
        key: requirement.key,
        severity: requirement.severity,
        problem: `too short (${present.length} chars, needs ${requirement.minLength})`,
        consequence: requirement.consequence,
      });
    }

    if (requirement.mustDifferFrom && present === value(requirement.mustDifferFrom)) {
      findings.push({
        key: requirement.key,
        severity: requirement.severity,
        problem: `identical to ${requirement.mustDifferFrom}`,
        consequence:
          `Rotating one would force rotating the other. For ${requirement.key} ` +
          `and ${requirement.mustDifferFrom} that means a routine secret rotation ` +
          "either signs everybody out or makes every merchant reconnect.",
      });
    }
  }

  // NEXT_PUBLIC_APP_ENV is the one variable whose wrong value is worse than its
  // absence, because the site looks completely fine either way.
  const appEnv = value("NEXT_PUBLIC_APP_ENV");
  if (isProduction && appEnv && appEnv !== "production") {
    findings.push({
      key: "NEXT_PUBLIC_APP_ENV",
      severity: "blocker",
      problem: `set to "${appEnv}" on a production deploy`,
      consequence:
        "The security policy is report-only and BETTER_AUTH_SECRET is not " +
        "checked. Nothing looks wrong.",
    });
  }

  return findings;
}

export const SEVERITY_ORDER: Record<Severity, number> = {
  blocker: 0,
  feature: 1,
  degraded: 2,
  optional: 3,
};
