import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The middleware's list of prerendered routes must match reality.
 *
 * ── Why this test exists ────────────────────────────────────────────
 * The CSP branches on whether a route is prerendered, because a nonce cannot
 * appear in HTML that was written at build time and is served to everyone. Get
 * that wrong in either direction and the failure is silent until a customer
 * sees it:
 *
 *   - a route prerendered but MISSING from the list gets the nonce policy.
 *     'strict-dynamic' voids 'self', the cached HTML carries no nonce, and every
 *     script on the page is refused. The page renders once and then does
 *     nothing at all.
 *
 *   - a route in the list that is NOT prerendered gets 'unsafe-inline' while
 *     rendering request-derived data. That is a quieter mistake and a worse one:
 *     the page works, so nobody notices the protection is gone.
 *
 * Adding a page is a completely ordinary thing to do, and Next decides on its
 * own whether to prerender it. So this cannot rely on anyone remembering.
 *
 * It reads Next's own prerender manifest rather than a copy of it, which means
 * it can only pass when the list agrees with what the build actually produced.
 */

const MANIFEST = resolve(process.cwd(), ".next/prerender-manifest.json");

/**
 * `next dev` writes its own .next/ with an empty prerender manifest and no
 * BUILD_ID. Reading that would report all ten routes as stale — a loud failure
 * describing a problem that does not exist, which is the fastest way to get a
 * check ignored. BUILD_ID is written only by `next build`, so it is the
 * discriminator.
 *
 * Skipping when there is no production build is the honest outcome: this test
 * has an opinion about what `next build` produced, and with no build it has
 * nothing to compare against. In CI it runs after the build, where it is real.
 */
const BUILD_ID = resolve(process.cwd(), ".next/BUILD_ID");

// The middleware is edge runtime, so its constant is read as source rather than
// imported — importing it would drag NextRequest and the edge globals into a
// Node test for no benefit.
function declaredRoutes(): string[] {
  const source = readFileSync(resolve(process.cwd(), "src/middleware.ts"), "utf8");
  const block = /const PRERENDERED = new Set\(\[([\s\S]*?)\]\)/.exec(source);
  if (!block?.[1]) throw new Error("Could not find PRERENDERED in src/middleware.ts");
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]!).sort();
}

const describeBuild = existsSync(MANIFEST) && existsSync(BUILD_ID) ? describe : describe.skip;

describeBuild("CSP route classification", () => {
  it("matches the routes Next actually prerenders", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
      routes: Record<string, unknown>;
    };
    const actual = Object.keys(manifest.routes).sort();

    // Reported as a set difference rather than a bare inequality, because the
    // useful information is which page moved and in which direction.
    const declared = declaredRoutes();
    const missing = actual.filter((r) => !declared.includes(r));
    const stale = declared.filter((r) => !actual.includes(r));

    expect(
      { missing, stale },
      "PRERENDERED in src/middleware.ts is out of date. Routes in `missing` are " +
        "prerendered but would be served the nonce policy — every script on them " +
        "will be blocked. Routes in `stale` are no longer prerendered and would " +
        "keep 'unsafe-inline' while rendering live data.",
    ).toEqual({ missing: [], stale: [] });
  });

  it("never puts an authenticated route on the relaxed policy", () => {
    // A belt-and-braces assertion that does not depend on the manifest: these
    // render customer data and must never be served 'unsafe-inline', whatever
    // the build decides.
    const declared = declaredRoutes();
    for (const prefix of ["/app", "/admin", "/welcome"]) {
      expect(declared.filter((r) => r === prefix || r.startsWith(`${prefix}/`))).toEqual([]);
    }
  });
});
