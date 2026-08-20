/**
 * Fail on React hydration mismatches.
 *
 * ── Why this is worth its own check ─────────────────────────────────
 * A mismatch is a warning in the console and nothing else. Nobody sees it, so
 * it accumulates — and the underlying cause is always the server and the client
 * disagreeing about what to render, which is one edit away from being a visible
 * bug rather than a warning.
 *
 * The one this was written for: Reveal branched on `useReducedMotion()` during
 * render. That hook knows nothing on the server, so the server always rendered
 * the animated branch and a reduced-motion client rendered the other one. React
 * reported it and moved on. The same branch was also why every page shipped its
 * copy at opacity 0 with no way back if scripts failed — see
 * tests/no-js-check.mjs. One root cause, one loud symptom nobody was reading
 * and one silent symptom nobody could see.
 *
 * Must run against `next dev`: React only performs and reports the comparison
 * in development. Both motion preferences are checked, because a mismatch that
 * only appears under prefers-reduced-motion is exactly the one no developer
 * hits by accident.
 *
 *   BASE=http://localhost:3000 node tests/hydration-check.mjs
 */

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3000";
const EXECUTABLE =
  process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const PAGES = [
  "/",
  "/pricing",
  "/services",
  "/how-it-works",
  "/contact",
  "/tools/store-health-scan",
  "/login",
  "/register",
];

const browser = await chromium.launch({ executablePath: EXECUTABLE });
let failures = 0;

for (const motion of ["no-preference", "reduce"]) {
  console.log(`\nprefers-reduced-motion: ${motion}\n`);
  const context = await browser.newContext({ reducedMotion: motion });

  for (const path of PAGES) {
    const page = await context.newPage();
    const problems = [];

    page.on("console", (m) => {
      const text = m.text();
      // "did not match", "hydrated but some attributes", "Hydration failed" —
      // React words it differently by cause, so match the shared stem.
      if (/hydrat/i.test(text) && m.type() === "error") problems.push(text.slice(0, 120));
    });

    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 120_000 });
    // Hydration errors are reported during the commit, which can be a moment
    // after the network settles on a dev server compiling a route.
    await page.waitForTimeout(2500);

    if (problems.length === 0) {
      console.log(`  ok    ${path}`);
    } else {
      failures += problems.length;
      console.log(`  FAIL  ${path} — ${problems.length} hydration error(s)`);
      console.log(`        ${problems[0]}`);
    }

    await page.close();
  }

  await context.close();
}

await browser.close();

console.log(`\n${failures === 0 ? "PASS — no hydration mismatches" : `FAIL — ${failures}`}\n`);
process.exit(failures === 0 ? 0 : 1);
