/**
 * End-to-end walkthrough of the M4 flow against a real dev server and a real
 * Postgres, driven by a real browser.
 *
 * This exists because none of the other checks can answer the question that
 * actually matters: can a person who has never used Unbolt register, get a
 * workspace, file a task, and see it on the board? Typechecking, unit tests and
 * even the SQL integration suite all pass with a portal that redirect-loops on
 * first sign-in — which is exactly the bug this walks.
 *
 *   node tests/e2e-flow.mjs
 */
import { chromium } from "playwright";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

// Granting a pack is an admin action with its own coverage in tests/m6-flow.mjs.
// Here it is a precondition: this file is about the task engine, and it needs a
// workspace that is allowed to file work.
const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
const EMAIL = `founder+${Date.now()}@acmesupply.com`;
const PASSWORD = "correct-horse-battery-staple-42";

/**
 * Client-side navigation only. router.replace() changes the URL without a load
 * event, so Playwright's waitForURL (which waits for "load" by default) hangs
 * forever on a navigation that already happened.
 */
async function waitForPath(target, re, timeout = 25_000) {
  const started = Date.now();
  for (;;) {
    const path = new URL(target.url()).pathname;
    if (re.test(path)) return path;
    if (Date.now() - started > timeout) {
      const visible = await target.locator("body").innerText().catch(() => "");
      throw new Error(`still on ${path}, expected ${re}. Page said: ${visible.slice(0, 300)}`);
    }
    await target.waitForTimeout(250);
  }
}

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  console.log(`${passed ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

// The sandbox ships a Chromium that this Playwright build does not know the
// revision of, so point at it explicitly rather than downloading another.
const EXECUTABLE = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
/**
 * Poll a predicate in the page.
 *
 * NOT page.waitForFunction: that compiles a string inside the page, and the
 * production Content-Security-Policy correctly refuses it — every wait in this
 * file threw EvalError the first time the suite was pointed at a real build.
 * page.evaluate goes over the debugger protocol and is not subject to the
 * policy, so polling it is both faithful to the browser a customer uses and
 * able to run under the same rules.
 */
async function waitFor(page, predicate, { timeout = 20_000, interval = 400, arg } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    // `arg` is passed explicitly: page.evaluate serialises the function and
    // runs it in a fresh context, so anything it closed over here is undefined
    // there. A predicate that silently reads undefined never becomes true and
    // the wait fails as a timeout, which reads like the app being slow.
    if (await page.evaluate(predicate, arg).catch(() => false)) return true;
    await page.waitForTimeout(interval);
  }
  return false;
}

const browser = await chromium.launch({ executablePath: EXECUTABLE });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

try {
  // ── 1. Register ───────────────────────────────────────────────────
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  check("register page renders", await page.locator("h1").isVisible());

  await page.getByLabel(/name/i).first().fill("Ana Fernandes");
  await page.getByLabel(/email/i).first().fill(EMAIL);
  await page.getByLabel(/password/i).first().fill(PASSWORD);

  await page.getByRole("button", { name: /create|start|sign up/i }).first().click();
  await waitForPath(page, /^\/welcome$/);

  // ── 2. The redirect loop this milestone had to fix ────────────────
  // A brand-new user has a session but no organisation. The old behaviour was
  // /app → /login → /app forever. Landing on /welcome is the whole fix.
  await page.waitForLoadState("networkidle");
  check(
    "new account lands on /welcome, not a redirect loop",
    new URL(page.url()).pathname === "/welcome",
    page.url(),
  );

  // ── 3. Workspace suggestion from the email domain ─────────────────
  const suggested = await page.getByLabel(/workspace name/i).inputValue();
  check("workspace name is pre-filled from the email domain", suggested === "Acmesupply", suggested);

  await page.getByLabel(/workspace name/i).fill("Acme Supply Co.");
  await page.getByRole("button", { name: /create workspace/i }).click();
  await waitForPath(page, /^\/app$/);
  check("creating a workspace lands in the portal", /\/app$/.test(page.url()), page.url());

  // ── 4. The empty state ────────────────────────────────────────────
  await page.waitForLoadState("networkidle");
  const emptyVisible = await page.getByText(/nothing in the queue yet/i).isVisible();
  check("a new workspace shows the empty queue invitation", emptyVisible);

  // ── 4b. A self-registered workspace has no pack ───────────────────
  //
  // This test predates the M6 model change and used to queue a task straight
  // after registering. It cannot any more, and that is correct: onboarding is
  // sales-led, so a workspace someone created themselves has no allowance until
  // a purchase is recorded. What matters is that the screen says so honestly
  // rather than presenting a form that refuses.
  const beforePack = await page.locator("body").innerText();
  check(
    "a workspace with no pack says so plainly",
    /doesn't have a pack yet|does not have a pack yet/i.test(beforePack),
  );
  check(
    "and does not claim they have used tasks they never had",
    !/used all 0 tasks/i.test(beforePack),
  );
  check(
    "and offers a route to getting started",
    await page.getByRole("link", { name: /talk to us about getting started/i }).isVisible(),
  );
  check(
    "with no task form to fill in",
    (await page.getByRole("textbox", { name: /what needs doing/i }).count()) === 0,
  );

  // Grant a pack the way an admin would, so the rest of this flow — which is
  // about the task engine, not about billing — can run.
  await pool.query(
    `UPDATE organizations SET credits_remaining = 5, credits_granted_total = 5
     WHERE id = (SELECT organization_id FROM memberships m
                 JOIN users u ON u.id = m.user_id WHERE u.email = $1)`,
    [EMAIL],
  );
  await page.reload({ waitUntil: "networkidle" });

  // ── 5. Queue a real task ──────────────────────────────────────────
  const title = "Variant swatches drop selection on mobile Safari";
  await page.getByLabel(/what needs doing/i).fill(title);
  await page.getByLabel(/anything else/i).fill("Happens on every product page after picking a size.");
  await page.getByRole("button", { name: /queue this task/i }).click();

  await waitFor(page, () => document.body.innerText.includes("UNB-"), { timeout: 25_000 });

  const confirmation = await page.getByText(/queued as/i).innerText();
  check("queueing returns the real reference the database assigned", /UNB-001/.test(confirmation), confirmation);

  // ── 6. The board reflects the write ───────────────────────────────
  await page.reload({ waitUntil: "networkidle" });
  check("the task appears on the board after reload", await page.getByText(title).isVisible());
  check(
    "the SLA promise is shown against the plan",
    /48 business hours/.test(await page.locator("body").innerText()),
  );

  const counters = await page.locator("body").innerText();
  check("the running/queued counters read from real rows", /0\/1\s*running/.test(counters.replace(/\s+/g, " ")));

  // ── 7. Tenant isolation, checked from the browser ─────────────────
  // A second account must not see the first one's work.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  await otherPage.getByLabel(/name/i).first().fill("Stranger");
  await otherPage.getByLabel(/email/i).first().fill(`stranger+${Date.now()}@other.com`);
  await otherPage.getByLabel(/password/i).first().fill(PASSWORD);
  await otherPage.getByRole("button", { name: /create|start|sign up/i }).first().click();
  await waitForPath(otherPage, /^\/welcome$/);
  await otherPage.getByLabel(/workspace name/i).fill("Other Brand");
  await otherPage.getByRole("button", { name: /create workspace/i }).click();
  await waitForPath(otherPage, /^\/app$/);
  await otherPage.waitForLoadState("networkidle");

  const otherBody = await otherPage.locator("body").innerText();
  check("a second workspace cannot see the first one's tasks", !otherBody.includes(title));
  check("the second workspace gets its own empty queue", /nothing in the queue yet/i.test(otherBody));
  await other.close();

  // ── 8. Signed out, the portal is closed ───────────────────────────
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto(`${BASE}/app`, { waitUntil: "networkidle" });
  check("signed out, /app redirects to sign in", /\/login/.test(anonPage.url()), anonPage.url());
  await anon.close();

  check("no console errors during the flow", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

  await page.screenshot({ path: "/tmp/portal-real.png", fullPage: true });
} finally {
  await browser.close();
  await pool.end();
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
