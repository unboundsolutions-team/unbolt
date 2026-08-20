/**
 * Capture the admin screens against the seeded demo data.
 *
 *   npm run seed:demo && node tests/admin-screens.mjs
 *
 * Also asserts each page rendered real content rather than an empty state or an
 * error boundary — a screenshot of a broken page still looks like a screenshot.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EXECUTABLE = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const OUT = process.env.OUT_DIR ?? "/tmp/admin";

const SCREENS = [
  { path: "/admin", file: "1-queue.png", expect: /waiting on an estimate/i },
  { path: "/admin/customers", file: "2-customers.png", expect: /accounts and allowances/i },
  { path: "/admin/plans", file: "3-plans.png", expect: /what each pack buys/i },
  { path: "/admin/leads", file: "4-leads.png", expect: /people waiting to hear back/i },
  { path: "/admin/team", file: "5-team.png", expect: /who can reach admin/i },
];

const browser = await chromium.launch({ executablePath: EXECUTABLE });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
  // The custom cursor and reveal animations are for people, not stills. Without
  // this the scroll-triggered sections photograph as blank slabs.
  reducedMotion: "reduce",
});
const page = await context.newPage();

let failures = 0;

try {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Work email" }).fill("arjun@unboundsolutions.in");
  await page.locator('input[name="password"]').fill("demo-password-not-for-real-use");
  await page.getByRole("button", { name: /sign in/i }).click();

  // Wait for the session cookie rather than a fixed delay. In dev the first
  // render of a route can take several seconds to compile, and a timeout tuned
  // to a warm server silently screenshots a half-loaded page.
  await page.waitForFunction(
    () => document.cookie.includes("unbolt.session") || true,
    undefined,
    { timeout: 15_000 },
  );
  for (let i = 0; i < 40; i += 1) {
    const cookies = await page.context().cookies();
    if (cookies.some((c) => c.name.includes("session_token"))) break;
    await page.waitForTimeout(500);
  }

  for (const screen of SCREENS) {
    await page.goto(`${BASE}${screen.path}`, { waitUntil: "networkidle" });

    // Wait for the page's own heading, not a guess at how long dev takes.
    await page
      .waitForFunction(
        (pattern) => new RegExp(pattern, "i").test(document.body.innerText),
        screen.expect.source,
        { timeout: 40_000 },
      )
      .catch(() => {});
    // A short settle so fonts and any deferred paint are done.
    await page.waitForTimeout(800);

    const text = await page.locator("body").innerText();
    const ok = screen.expect.test(text);
    if (!ok) failures += 1;
    console.log(`${ok ? "  ✓" : "  ✗"} ${screen.path}${ok ? "" : " — did not render as expected"}`);

    await page.screenshot({ path: `${OUT}/${screen.file}`, fullPage: true });
  }
} finally {
  await browser.close();
}

console.log(`\n${SCREENS.length - failures}/${SCREENS.length} screens captured`);
process.exit(failures === 0 ? 0 : 1);
