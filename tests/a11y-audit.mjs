/**
 * Accessibility audit against the running app.
 *
 * ── Why this is not the contrast script ─────────────────────────────
 * scripts/check-contrast.ts reasons about the palette. It cannot see a heading
 * level that skips, a button that is a div, a form control with no label, or a
 * dialog that does not trap focus — and those are the failures that actually
 * stop somebody using the portal. This drives axe over the real DOM of the real
 * pages, signed in, with the seeded data in place.
 *
 * ── What it checks and what it deliberately does not ────────────────
 * WCAG 2.1 A and AA only. axe also ships "best-practice" rules, which are
 * opinions rather than the standard; mixing them in means a wall of advice with
 * the real failures buried in it.
 *
 * Findings are reported per page with the element and the fix, because
 * "critical: 3" is not something anybody can act on.
 *
 *   npm run seed:demo
 *   BASE=http://localhost:3000 node tests/a11y-audit.mjs
 */

import { readFileSync } from "node:fs";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3000";
const EXECUTABLE =
  process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const AXE = readFileSync("node_modules/axe-core/axe.min.js", "utf8");

const PUBLIC_PAGES = [
  { path: "/", name: "home" },
  { path: "/pricing", name: "pricing" },
  { path: "/services", name: "services" },
  { path: "/how-it-works", name: "how it works" },
  { path: "/contact", name: "contact" },
  { path: "/tools/store-health-scan", name: "store health scan" },
  { path: "/login", name: "sign in" },
  { path: "/register", name: "register" },
  { path: "/legal/terms", name: "terms" },
  { path: "/legal/privacy", name: "privacy" },
  { path: "/security", name: "security" },
  { path: "/definitely-not-a-page", name: "404" },
];

// Signed-in pages. These are where a real customer and our own team spend their
// day, and they are the ones nobody audits because you have to log in first.
const PRIVATE_PAGES = [
  { path: "/app", name: "portal" },
  { path: "/app/tasks", name: "task board" },
  { path: "/app/stores", name: "stores" },
  { path: "/admin", name: "admin queue" },
  { path: "/admin/customers", name: "admin customers" },
  { path: "/admin/plans", name: "admin plans" },
  { path: "/admin/leads", name: "admin leads" },
  { path: "/admin/team", name: "admin team" },
];

const IMPACT_ORDER = { critical: 0, serious: 1, moderate: 2, minor: 3 };

const browser = await chromium.launch({ executablePath: EXECUTABLE });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  // Reveal-on-scroll sections start at opacity 0. Under normal motion axe would
  // audit a page most of whose content is invisible and report a clean bill of
  // health for markup it never looked at.
  reducedMotion: "reduce",
});
const page = await context.newPage();

const allViolations = [];

async function audit(label, path) {
  // Generous, because a dev server compiles a route on first request and can
  // take the better part of a minute after an edit. A default timeout here
  // turns "the server was busy" into "the audit failed", which is the kind of
  // flake that gets a check switched off.
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForSelector("main, h1", { timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(600);

  await page.evaluate(AXE);

  // WCAG 2.1 A/AA, plus a short list of rules axe files under "best-practice"
  // that are not opinions about style.
  //
  // heading-order is here because scoping to the WCAG tags alone missed a real
  // defect: two pages rendered an h3 directly under the hero h1, so anyone
  // navigating by heading level — which is how screen reader users skim a page
  // — landed in a subsection with no section. This audit passed those pages
  // clean; the Lighthouse budget caught it the first time it was ever run.
  await page.evaluate(() => {
    window.__WCAG_RULES = window.axe
      .getRules(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .map((r) => r.ruleId);
    window.__EXTRA_RULES = [
      "heading-order",
      "landmark-one-main",
      "region",
      "page-has-heading-one",
    ];
  });
  const result = await page.evaluate(async () => {
    return await window.axe.run(document, {
      runOnly: {
        type: "rule",
        values: [...window.__WCAG_RULES, ...window.__EXTRA_RULES],
      },
      resultTypes: ["violations"],
    });
  });

  const violations = result.violations.sort(
    (a, b) => (IMPACT_ORDER[a.impact] ?? 9) - (IMPACT_ORDER[b.impact] ?? 9),
  );

  if (violations.length === 0) {
    console.log(`  ok    ${label}`);
    return;
  }

  console.log(`  ${violations.length} issue(s)  ${label}  (${path})`);
  for (const v of violations) {
    console.log(`      [${v.impact}] ${v.id} — ${v.help}`);
    for (const node of v.nodes.slice(0, 3)) {
      console.log(`        ${node.target.join(" ")}`);
      const fix = (node.failureSummary ?? "").split("\n").filter(Boolean)[1];
      if (fix) console.log(`          ${fix.trim()}`);
    }
    if (v.nodes.length > 3) console.log(`        …and ${v.nodes.length - 3} more`);
    allViolations.push({ page: label, ...v });
  }
}

console.log("\nPublic pages\n");
for (const p of PUBLIC_PAGES) await audit(p.name, p.path);

const PASSWORD = "demo-password-not-for-real-use";
const STAFF = "arjun@unboundsolutions.in";
const CUSTOMER = "priya@northline.co";

async function signIn(email) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });

  // Wait for React to own the form before touching it.
  //
  // The markup is server-rendered, so the button is clickable a beat before
  // onSubmit exists. Clicking in that window submits natively and navigates
  // away — which is how this script first failed, and is why the form now
  // carries method="post". Poll for React's props key rather than guessing at
  // a delay: an implementation detail, but an exact answer to "are the
  // handlers on yet", and it lives in the test rather than in the app.
  //
  // Polled with evaluate rather than waitForFunction, because
  // waitForFunction compiles a string inside the page and the enforcing CSP
  // correctly refuses that. The test has to live under the same policy as
  // everybody else.
  for (let i = 0; i < 60; i += 1) {
    const ready = await page.evaluate(() => {
      const form = document.querySelector("form");
      return !!form && Object.keys(form).some((k) => k.startsWith("__reactProps$"));
    });
    if (ready) break;
    await page.waitForTimeout(500);
  }

  await page.getByRole("textbox", { name: "Work email" }).fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();

  for (let i = 0; i < 40; i += 1) {
    const cookies = await context.cookies();
    if (cookies.some((c) => c.name.includes("session_token"))) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

console.log("\nSigning in as the seeded admin\n");
if (!(await signIn(STAFF))) {
  console.log("  FAIL  could not sign in — the signed-in pages were NOT audited");
  process.exitCode = 1;
} else {
  console.log("  ok    signed in\n");
  console.log("Signed-in pages\n");
  for (const p of PRIVATE_PAGES) await audit(p.name, p.path);

  // ── The customer's side ───────────────────────────────────────────
  //
  // Staff have no organisation membership, so signing in as an admin shows an
  // empty board and audits nothing. The portal and the task detail page only
  // have content for a customer, and the task detail page is the densest thing
  // in the product — state machine, estimate, comments, timeline — so it is the
  // last page that should go unaudited.
  await context.clearCookies();
  if (!(await signIn(CUSTOMER))) {
    console.log("  FAIL  could not sign in as a customer");
    process.exitCode = 1;
  }

  console.log("\nCustomer pages\n");
  await audit("customer portal", "/app");
  await audit("customer task board", "/app/tasks");

  await page.goto(`${BASE}/app/tasks`, { waitUntil: "networkidle" });
  const href = await page
    .locator('a[href^="/app/tasks/"]')
    .first()
    .getAttribute("href")
    .catch(() => null);
  if (href) await audit("task detail", href);
  else {
    console.log("  FAIL  no task link found — the task detail page was NOT audited");
    process.exitCode = 1;
  }
}

await browser.close();

const bySeverity = allViolations.reduce((acc, v) => {
  acc[v.impact] = (acc[v.impact] ?? 0) + 1;
  return acc;
}, {});

console.log(
  `\n${allViolations.length === 0 ? "PASS — no WCAG A/AA violations" : `${allViolations.length} violation(s): ${JSON.stringify(bySeverity)}`}\n`,
);
if (allViolations.length > 0) process.exitCode = 1;
