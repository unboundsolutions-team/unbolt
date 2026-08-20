/**
 * Does the enforcing Content-Security-Policy break the site?
 *
 * The middleware ships a strict policy in production: nonce + 'strict-dynamic'
 * for scripts, no 'unsafe-eval', no 'unsafe-inline' for scripts. That policy is
 * never exercised in development, because Next's HMR requires eval and the
 * middleware relaxes the policy to allow it. The only honest test is therefore a
 * real production build served with the production policy, which is what this
 * runs against.
 *
 * A CSP failure does not look like an error page. It looks like a page that
 * renders and then does nothing: no hydration, no navigation, a form that
 * silently refuses to submit. That is why this reads violations out of the
 * browser rather than judging screenshots.
 *
 * The second half tests the case the preloader failsafe exists for. The overlay
 * is server-rendered opaque and full-screen, and in the normal path only
 * JavaScript removes it. If JavaScript never runs — a blocked chunk, a
 * hydration crash, an extension, a CSP mistake — the site becomes a blank
 * rectangle that swallows every click. The CSS animation is the floor under
 * that. Disabling JavaScript is the cheapest faithful simulation of all of
 * those failures at once.
 *
 *   BASE=http://localhost:3100 node tests/csp-check.mjs
 *
 * The two servers must not run at once from the same checkout: `next dev`
 * rewrites .next/ underneath a running `next start`, which then serves chunks
 * that no longer exist. The symptom is every page failing to hydrate, which
 * reads exactly like a CSP failure and is not one. Run the passes separately,
 * or give the dev server its own distDir.
 */

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3100";

/**
 * Pages that render without a database.
 *
 * `next start` forces NODE_ENV=production, and the database client honours
 * DEVELOPMENT_DATABASE_URL only outside production — a deliberate guard so no
 * stray variable can point live traffic at a dev box. That guard also means the
 * database-backed routes cannot be served from a production build here. It
 * costs nothing: the policy comes from middleware and is identical on every
 * route, and the client bootstrap these pages exercise is the same one.
 */
const PAGES = [
  "/login",
  "/register",
  "/how-it-works",
  "/services",
  "/tools/store-health-scan",
];

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.log(`  FAIL  ${msg}`);
};
const pass = (msg) => console.log(`  ok    ${msg}`);

const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});

// ── The header itself ───────────────────────────────────────────────
//
// The policy is not one policy. Prerendered routes get 'unsafe-inline' because
// build-time HTML cannot carry a per-request nonce; everything that renders
// request-derived data gets the nonce. So the invariants that must hold
// everywhere are checked separately from the parts that legitimately differ.
console.log("\nPolicy served\n");
{
  const res = await fetch(`${BASE}/login`);
  const policy = res.headers.get("content-security-policy") ?? "";
  const report = res.headers.get("content-security-policy-report-only");
  const scriptSrc = policy.split("script-src")[1]?.split(";")[0] ?? "";

  if (!policy) fail("no enforcing CSP header — the policy is not actually on");
  else pass("enforcing header present (not report-only)");
  if (report) fail("still shipping a report-only policy alongside the enforcing one");

  // 'unsafe-eval' is the one script relaxation that is never justified here:
  // nothing in the app evaluates strings, and it is the directive that turns a
  // JSON-injection bug into code execution.
  if (scriptSrc.includes("unsafe-eval")) fail("script-src allows 'unsafe-eval' in production");
  else pass("no 'unsafe-eval'");

  // These four do the work that does not depend on how the page is rendered,
  // and they are what still protects a page served the relaxed policy.
  for (const [directive, label] of [
    ["frame-ancestors 'none'", "clickjacking prevented"],
    ["object-src 'none'", "no plugin content"],
    ["base-uri 'self'", "injected <base> cannot redirect relative URLs"],
    ["form-action 'self'", "a form cannot be repointed off-origin"],
  ]) {
    if (policy.includes(directive)) pass(label);
    else fail(`missing ${directive} — ${label} does not hold`);
  }

  if (scriptSrc.includes("strict-dynamic") && scriptSrc.includes("unsafe-inline")) {
    fail("'strict-dynamic' with 'unsafe-inline' — strict-dynamic voids it, this is confused");
  }
}

// ── With JavaScript, under the real policy ──────────────────────────
console.log("\nEnforcing CSP, JavaScript enabled\n");
{
  const context = await browser.newContext();
  for (const path of PAGES) {
    const page = await context.newPage();
    const violations = [];
    const errors = [];

    // Both channels matter. Blocked resources surface as console warnings;
    // removing 'unsafe-eval' surfaces as a thrown EvalError, which is not a
    // resource block and would otherwise go unnoticed.
    page.on("console", (m) => {
      const t = m.text();
      if (/Content Security Policy|Refused to/i.test(t)) violations.push(t);
    });
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });

    // The preloader unmounts itself once its counter finishes. Its
    // disappearance from the DOM — well before the 6s CSS failsafe could act —
    // is proof that the chunks loaded, React hydrated, and effects ran. If CSP
    // had blocked the bundle this element would still be sitting there.
    //
    // "Detached" is only evidence if it was ever attached: a page that never
    // renders an overlay would otherwise report hydration success while its
    // scripts sat blocked. So the server HTML is checked first.
    // One fetch, read for both the header and the body: the nonce is
    // per-response, so comparing a header from one request against HTML from
    // another would never match and would prove nothing.
    const served = await fetch(`${BASE}${path}`);
    const html = await served.text();
    const hasOverlay = html.includes("data-preloader");
    const hydrated = hasOverlay
      ? await page
          .waitForSelector("[data-preloader]", { state: "detached", timeout: 5000 })
          .then(() => true)
          .catch(() => false)
      : null;

    console.log(path);
    if (violations.length) violations.forEach((v) => fail(`CSP: ${v.slice(0, 160)}`));
    else pass("no CSP violations");

    if (errors.length) errors.forEach((e) => fail(`page error: ${e.slice(0, 160)}`));
    else pass("no uncaught page errors");

    if (hydrated === null) fail("no preloader in the server HTML — probe cannot prove hydration");
    else if (hydrated) pass("scripts ran and React unmounted the overlay");
    else fail("overlay never removed by JS — scripts did not run under this policy");

    // Independent of the overlay: the nonce must actually be on the scripts on
    // any route that is served a nonce policy. A policy naming a nonce nothing
    // carries is the exact bug this whole pass exists to catch.
    const policy = served.headers.get("content-security-policy") ?? "";
    const noncePolicy = /nonce-([a-f0-9]+)/.exec(policy)?.[1];
    if (noncePolicy) {
      if (html.includes(`nonce="${noncePolicy}"`)) pass("nonce is on the script tags");
      else fail("policy names a nonce that appears on no script tag");
    } else {
      pass("prerendered route, served the no-nonce policy");
    }

    // Uncovered is not the same as usable. Ask the browser what is under the
    // cursor where a visitor would click.
    const topEl = await page.evaluate(() => {
      const el = document.elementFromPoint(window.innerWidth / 2, 200);
      return el ? `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ")[0] : ""}` : "nothing";
    });
    pass(`clickable surface at centre: ${topEl}`);

    await page.close();
  }
  await context.close();
}

// ── Without JavaScript, which is what the failsafe is for ───────────
console.log("\nJavaScript disabled — the failsafe's reason for existing\n");
{
  const context = await browser.newContext({ javaScriptEnabled: false });
  for (const path of ["/login", "/how-it-works"]) {
    const page = await context.newPage();
    await page.goto(`${BASE}${path}`, { waitUntil: "load" });

    // The animation is a 1ms step delayed by 6s. Wait past it, then ask the
    // browser what is really there.
    await page.waitForTimeout(7500);

    const state = await page.evaluate(() => {
      const pre = document.querySelector("[data-preloader]");
      if (!pre) return { present: false };
      const cs = getComputedStyle(pre);
      const el = document.elementFromPoint(window.innerWidth / 2, 200);
      return {
        present: true,
        visibility: cs.visibility,
        opacity: cs.opacity,
        intercepting: pre === el || pre.contains(el),
      };
    });

    console.log(path);
    if (!state.present) {
      pass("no overlay rendered at all");
    } else if (state.intercepting) {
      fail(
        `overlay still covers the page with JS off ` +
          `(visibility=${state.visibility}, opacity=${state.opacity}) — ` +
          `any JS failure is a total outage`,
      );
    } else {
      pass(`overlay cleared by CSS alone (visibility=${state.visibility})`);
    }

    // Uncovered is worthless if there is nothing underneath to read.
    const text = await page.evaluate(() => document.body.innerText.trim().length);
    if (text > 200) pass(`content readable without JS (${text} chars)`);
    else fail(`almost no readable content with JS off (${text} chars)`);

    await page.close();
  }
  await context.close();
}

// ── The nonce branch ────────────────────────────────────────────────
//
// Every route that gets a nonce also needs the database, and `next start`
// forces NODE_ENV=production, where the local-database escape hatch is
// deliberately disabled. So the nonce branch cannot be served from the
// production build here.
//
// It still has to be tested, because it is the branch that was broken: the
// nonce was set on the response and never on the request, so Next never stamped
// it onto a single script tag while the header looked perfect. That is a
// structural property of the rendered HTML — the nonce named in the header must
// appear on the scripts — and it does not depend on NODE_ENV. Point
// DYNAMIC_BASE at a dev server (started with NEXT_PUBLIC_APP_ENV=production so
// the enforcing policy is chosen) and it can be checked directly.
if (process.env.DYNAMIC_BASE) {
  console.log("\nNonce branch, on routes that render live data\n");
  for (const path of ["/", "/pricing", "/contact"]) {
    const res = await fetch(`${process.env.DYNAMIC_BASE}${path}`);
    const html = await res.text();
    const policy = res.headers.get("content-security-policy") ?? "";
    const nonce = /nonce-([a-f0-9]+)/.exec(policy)?.[1];

    console.log(path);
    if (res.status !== 200) {
      fail(`HTTP ${res.status}`);
      continue;
    }
    if (!nonce) {
      fail("no nonce in the policy — this route should not be on the relaxed policy");
      continue;
    }
    const stamped = html.split(`nonce="${nonce}"`).length - 1;
    if (stamped > 0) pass(`nonce stamped on ${stamped} script tag(s)`);
    else fail("policy names a nonce that appears nowhere in the HTML — every script blocked");

    // A script tag without the nonce is a script that will not run, since
    // 'strict-dynamic' means 'self' no longer admits it. Reported with the tag
    // itself, because "one script is unnonced" is not actionable on its own.
    const bare = [...html.matchAll(/<script(?![^>]*nonce=)[^>]*>/g)].map((m) => m[0]);
    if (bare.length === 0) pass("no unnonced script tags");
    else bare.forEach((t) => fail(`unnonced and will be refused: ${t.slice(0, 90)}`));
  }
}

await browser.close();

console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} problem(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);
