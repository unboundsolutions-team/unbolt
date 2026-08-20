/**
 * What does a visitor see when the JavaScript does not run?
 *
 * ── Why this is not paranoia ────────────────────────────────────────
 * It already happened twice in this codebase, and neither was visible in any
 * other check:
 *
 *  - the preloader is a server-rendered opaque full-screen cover that only JS
 *    removes, so any script failure was a black screen with nothing clickable;
 *  - Reveal and SplitText server-render their content at opacity 0 and
 *    translated out of an overflow-hidden box, because that is where their
 *    animation starts. With scripts off, /how-it-works painted 190 characters
 *    out of 2,637. The HTML was complete and correct and the page was blank.
 *
 * Both were invisible to typechecking, to the unit suite, to the CSP check and
 * to axe, because in all of those the scripts run.
 *
 * ── Why it measures painted text rather than innerText ──────────────
 * innerText skips visibility:hidden but happily returns text inside an
 * opacity:0 ancestor. A naive check reports thousands of characters on a page
 * showing nothing — which is exactly what the first version of this did, and
 * why the Reveal bug survived a pass that was supposed to catch it. So this
 * walks the tree and counts only text with no dimmed ancestor.
 *
 * Disabling JavaScript is a stand-in for every way it fails: a chunk that 404s
 * after a bad deploy, a policy that blocks the bundle, an extension, a
 * hydration crash, a corporate proxy. They all land in the same place.
 *
 *   BASE=http://localhost:3100 node tests/no-js-check.mjs
 */

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3100";
const EXECUTABLE =
  process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

/**
 * Minimum painted characters per page.
 *
 * Set from what each page actually paints, with room to spare — this is not a
 * rule about page length, it is a floor that a regression to "invisible" falls
 * through. For scale: when Reveal was hiding everything, /how-it-works painted
 * 190 against the 2,111 it paints now and /services painted 57 against 862.
 * Any recurrence lands far below these numbers.
 *
 * Point this at a server that can serve every route. `next start` cannot serve
 * the database-backed ones locally, because it forces NODE_ENV=production and
 * the local-database escape hatch is deliberately off there.
 */
const PAGES = [
  { path: "/", min: 1800 },
  { path: "/how-it-works", min: 1200 },
  { path: "/services", min: 500 },
  { path: "/pricing", min: 1200 },
  { path: "/contact", min: 300 },
  { path: "/tools/store-health-scan", min: 550 },
  { path: "/login", min: 150 },
  // Legal text is the one thing on the site that must be readable no matter
  // what: somebody checking terms before paying, or a privacy request, cannot
  // depend on a bundle loading.
  { path: "/legal/terms", min: 2000 },
  { path: "/legal/privacy", min: 2000 },
  { path: "/security", min: 1500 },
];

const browser = await chromium.launch({ executablePath: EXECUTABLE });
const context = await browser.newContext({ javaScriptEnabled: false });
const page = await context.newPage();

let failures = 0;

for (const target of PAGES) {
  const res = await page.goto(`${BASE}${target.path}`, {
    waitUntil: "load",
    timeout: 120_000,
  });

  if (!res || res.status() >= 400) {
    console.log(`  FAIL  ${target.path} — HTTP ${res?.status() ?? "no response"}`);
    failures += 1;
    continue;
  }

  // Past every failsafe delay in the app: the preloader's 6s and the animation
  // failsafe's 5s.
  await page.waitForTimeout(7500);

  const seen = await page.evaluate(() => {
    // Counts a node's OWN text nodes at every level, not just leaves. Counting
    // only leaves loses the direct text of any element that also contains a
    // link — which is most real prose, and is how the first version of this
    // reported 83 characters for a page showing three readable sentences.
    const painted = (node, dimmed) => {
      let total = 0;
      if (!dimmed) {
        for (const child of node.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) total += child.textContent.trim().length;
        }
      }
      for (const child of node.children) {
        const cs = getComputedStyle(child);
        const hidden =
          dimmed ||
          parseFloat(cs.opacity) < 0.1 ||
          cs.visibility === "hidden" ||
          cs.display === "none";
        total += painted(child, hidden);
      }
      return total;
    };
    const root = document.querySelector("main") ?? document.body;
    const cs = getComputedStyle(root);
    return painted(root, parseFloat(cs.opacity) < 0.1 || cs.visibility === "hidden");
  });

  // An overlay left covering the page is the other half of the same failure:
  // text can be painted and still be behind something opaque.
  const covered = await page.evaluate(() => {
    const el = document.elementFromPoint(window.innerWidth / 2, 250);
    const pre = document.querySelector("[data-preloader]");
    return !!pre && (pre === el || pre.contains(el));
  });

  const ok = seen >= target.min && !covered;
  if (ok) {
    console.log(`  ok    ${target.path} — ${seen} characters painted`);
  } else {
    failures += 1;
    console.log(
      `  FAIL  ${target.path} — ${seen} characters painted (need ${target.min})` +
        (covered ? ", and an overlay is still covering the page" : ""),
    );
  }
}

await browser.close();

console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} page(s) unreadable without JS`}\n`);
process.exit(failures === 0 ? 0 : 1);
