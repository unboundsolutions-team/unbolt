import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { execSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { checkEnvironment, REQUIREMENTS } from "@/server/env-requirements";

/**
 * Keep the environment list honest in both directions.
 *
 * ── The two ways this drifts, and why both hurt ─────────────────────
 * A variable read by the code but absent from the list is one the preflight
 * will not ask about, so a deploy passes and the feature is broken.
 *
 * A variable in `.env.example` that nothing reads is worse, because somebody
 * sets it, believes the feature is configured, and it is not. `.env.example`
 * had four of these — Upstash Redis, Sentry, PostHog and Resend — left over
 * from a plan that changed. Rate limiting moved to Postgres in M7 and the
 * Upstash entries stayed, which reads as "rate limiting needs Redis" to anyone
 * setting this project up.
 */

const ROOT = resolve(process.cwd());

/** Every env key the application source actually reads. */
function keysReadByCode(): Set<string> {
  // ripgrep over the source, matching both dotted and bracketed reads of
  // process.env. Reading the source is the only way to get this right; a
  // hand-maintained second list would drift exactly like the first one did.
  //
  // (Deliberately no example of the matched syntax written out here — the scan
  // reads this file too, and an illustrative name in a comment is picked up as
  // a real variable. Which is itself a small proof that it is reading source
  // rather than a list somebody keeps.)
  //
  // tests/ is included because a variable used only by the test suite —
  // TEST_DATABASE_URL — is still a variable somebody has to set, and belongs in
  // .env.example rather than being special-cased into an exemption list.
  const out = execSync(
    `rg -oNI --no-messages 'process\\.env\\[?["'"'"']?([A-Z_][A-Z0-9_]*)' -r '$1' ` +
      `${ROOT}/src ${ROOT}/netlify ${ROOT}/scripts ${ROOT}/tests || true`,
    { encoding: "utf8", shell: "/bin/bash" },
  );
  return new Set(
    out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** Keys documented in .env.example. */
function keysInExample(): Set<string> {
  const text = readFileSync(resolve(ROOT, ".env.example"), "utf8");
  return new Set([...text.matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1]!));
}

/**
 * Variables the platform or the toolchain sets, which the app reads but nobody
 * configures. Listing them as requirements would be noise.
 */
const PLATFORM_PROVIDED = new Set([
  "NODE_ENV",
  "URL",
  "DEPLOY_PRIME_URL",
  "DEVELOPMENT_DATABASE_URL",
  "TEST_DATABASE_URL",
  "CHROMIUM_PATH",
  "BASE",
  "BASE_URL",
  "DYNAMIC_BASE",
  "OUT_DIR",
]);

describe("environment requirements", () => {
  const declared = new Set(REQUIREMENTS.map((r) => r.key));

  it("covers every variable the code reads", () => {
    const undeclared = [...keysReadByCode()].filter(
      (k) => !declared.has(k) && !PLATFORM_PROVIDED.has(k),
    );

    expect(
      undeclared,
      "These are read by the app but are not in REQUIREMENTS, so the preflight " +
        "will not ask about them and a deploy missing one passes silently. Add " +
        "them to src/server/env-requirements.ts with the consequence of their " +
        "absence, or to PLATFORM_PROVIDED here if nobody configures them.",
    ).toEqual([]);
  });

  it("does not document anything the code never reads", () => {
    const read = keysReadByCode();
    const phantom = [...keysInExample()].filter((k) => !read.has(k) && !declared.has(k));

    expect(
      phantom,
      "These appear in .env.example but nothing reads them. Somebody will set " +
        "one and believe a feature is configured when it is not.",
    ).toEqual([]);
  });

  it("documents every declared requirement in .env.example", () => {
    const example = keysInExample();
    const missing = REQUIREMENTS.map((r) => r.key).filter((k) => !example.has(k));

    expect(
      missing,
      "Declared as required but absent from .env.example — the file people copy " +
        "when setting this up.",
    ).toEqual([]);
  });

  describe("the checker itself", () => {
    it("blocks a production deploy with no database and no auth secret", () => {
      const findings = checkEnvironment(
        { NEXT_PUBLIC_APP_ENV: "production" },
        { isProduction: true },
      );
      const blockers = findings.filter((f) => f.severity === "blocker").map((f) => f.key);
      expect(blockers).toContain("NETLIFY_DATABASE_URL");
      expect(blockers).toContain("BETTER_AUTH_SECRET");
    });

    it("refuses an auth secret short enough to guess", () => {
      const findings = checkEnvironment(
        { NEXT_PUBLIC_APP_ENV: "production", BETTER_AUTH_SECRET: "hunter2" },
        { isProduction: true },
      );
      expect(findings.find((f) => f.key === "BETTER_AUTH_SECRET")?.problem).toMatch(/too short/);
    });

    it("refuses to let the two secrets be the same value", () => {
      // Convenient, and it welds two independent rotation schedules together:
      // rotating the auth secret would make every merchant reconnect.
      const shared = "x".repeat(40);
      const findings = checkEnvironment(
        {
          NEXT_PUBLIC_APP_ENV: "production",
          BETTER_AUTH_SECRET: shared,
          SHOPIFY_TOKEN_KEY: shared,
          NETLIFY_DATABASE_URL: "postgres://x",
        },
        { isProduction: true },
      );
      expect(findings.map((f) => f.problem)).toContain("identical to SHOPIFY_TOKEN_KEY");
    });

    it("catches a production deploy whose APP_ENV says otherwise", () => {
      // The worst case in the whole list: the site works perfectly, the policy
      // is report-only, and the auth-secret guard never runs.
      const findings = checkEnvironment(
        {
          NEXT_PUBLIC_APP_ENV: "staging",
          NETLIFY_DATABASE_URL: "postgres://x",
          BETTER_AUTH_SECRET: "y".repeat(40),
        },
        { isProduction: true },
      );
      expect(findings.find((f) => f.key === "NEXT_PUBLIC_APP_ENV")?.problem).toMatch(
        /set to "staging"/,
      );
    });

    it("does not demand a Stripe webhook secret when Stripe is off", () => {
      const findings = checkEnvironment({}, { isProduction: false });
      expect(findings.map((f) => f.key)).not.toContain("STRIPE_WEBHOOK_SECRET");
    });

    it("demands one the moment Stripe is switched on", () => {
      const findings = checkEnvironment({ STRIPE_SECRET_KEY: "sk_test_x" }, { isProduction: false });
      expect(findings.map((f) => f.key)).toContain("STRIPE_WEBHOOK_SECRET");
    });
  });
});
