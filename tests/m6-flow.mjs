/**
 * M6 end-to-end: the sales-led lifecycle, driven through the real running app.
 *
 * lead → admin provisions → payment recorded → credits released →
 * customer signs in → submits until the pack is spent → estimate holds an
 * oversized task → comment thread → admin sells another pack.
 *
 *   node tests/m6-flow.mjs
 */
import { chromium } from "playwright";
import pg from "pg";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EXECUTABLE = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const STAFF_PASSWORD = "staff-password-that-is-long-enough";

const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  console.log(`${passed ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

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

/*
 * Clear this address's contact-form allowance before starting.
 *
 * The form is rate limited to five submissions an hour per caller, which is
 * correct and which makes this suite non-repeatable: the sixth run of the day
 * from one machine gets refused and the failure reads as "the lead is not
 * stored" — a bug report about the wrong feature entirely.
 *
 * Clearing the bucket rather than exempting the test keeps the limiter in the
 * path being exercised. It is the same reason the fake Shopify in M5 speaks
 * real TLS instead of taking an override.
 */
await pool.query(`DELETE FROM rate_limits WHERE bucket LIKE 'lead:%'`);

const browser = await chromium.launch({ executablePath: EXECUTABLE });

try {
  // ── A visitor enquires from the pricing page ──────────────────────
  const visitor = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await visitor.newPage();

  await page.goto(`${BASE}/pricing`, { waitUntil: "networkidle" });
  const pricingText = await page.locator("body").innerText();

  check("pricing page no longer promises an unlimited queue", !/unlimited/i.test(pricingText));
  check(
    "pricing shows the pack size from the database",
    /tasks, yours until you use them/i.test(pricingText),
  );
  check("prices are one-off, not monthly", /one-off/i.test(pricingText) && !/\/mo\b/.test(pricingText));

  // Plan selection routes to a conversation, not a checkout.
  await page.getByRole("link", { name: /talk to us about professional/i }).first().click();
  // waitForLoadState("networkidle") returns before a client-side navigation has
  // updated the URL, so wait on the URL itself.
  await page.waitForURL(/\/contact/, { timeout: 20_000 });
  check(
    "choosing a plan routes to the contact form, carrying the plan",
    /\/contact\?plan=professional/.test(page.url()),
    page.url(),
  );

  const leadEmail = `founder+${Date.now()}@northline.co`;
  await page.getByLabel(/your name/i).fill("Priya Raman");
  await page.getByLabel(/work email/i).fill(leadEmail);
  await page.getByRole("textbox", { name: "Company" }).fill("Northline Supply");
  await page.getByRole("textbox", { name: "What needs doing?" }).fill("Checkout drops the discount code on mobile.");
  await page.getByRole("button", { name: /send it/i }).click();

  await waitFor(page, () => /that.s with us/i.test(document.body.innerText), { timeout: 20_000 });
  check("the enquiry is confirmed to the visitor", true);

  const lead = await pool.query(
    `SELECT l.name, l.wants_demo, p.code AS plan FROM leads l
     LEFT JOIN plans p ON p.id = l.interested_plan_id WHERE l.email = $1`,
    [leadEmail],
  );
  check("the lead is stored", lead.rows.length === 1, lead.rows[0]?.name ?? "missing");
  // The plan they clicked has to survive into the record, or the sales call
  // starts by asking a question the visitor already answered.
  check("the plan they clicked is carried into the lead", lead.rows[0]?.plan === "professional", String(lead.rows[0]?.plan));
  await visitor.close();

  // ── Staff sign in ─────────────────────────────────────────────────
  const staffEmail = `staff+${Date.now()}@unbound.dev`;
  const staffCtx = await browser.newContext();
  const staff = await staffCtx.newPage();

  await staff.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  // Role-based and exact. getByLabel(/name/i) also matches the footer's
  // <nav aria-label="Company">, and .first() then silently fills the wrong
  // thing — which is how this step failed without reporting anything.
  await staff.getByRole("textbox", { name: "Your name" }).fill("Ops");
  await staff.getByRole("textbox", { name: "Work email" }).fill(staffEmail);
  await staff.locator('input[name="password"]').fill(STAFF_PASSWORD);
  await staff.getByRole("button", { name: /create account/i }).click();

  // Wait for the account to actually exist rather than guessing at a delay.
  await waitFor(staff, () => !/^\/register/.test(window.location.pathname), { timeout: 20_000 });

  // Promote to staff, the way an existing superadmin would. `internal_role` is
  // not optional: a CHECK constraint from M0 requires it whenever is_internal
  // is set, so "staff" without a role is not a state the schema allows.
  //
  // NOTE: there is no UI for this yet. Staff onboarding is a real gap.
  await pool.query(
    `UPDATE users SET is_internal = true, internal_role = 'superadmin' WHERE email = $1`,
    [staffEmail],
  );

  await staff.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  check(
    "staff with no customer org can reach /admin",
    /\/admin/.test(staff.url()) && !/welcome|login/.test(staff.url()),
    staff.url(),
  );

  // ── Plans are editable ────────────────────────────────────────────
  await staff.goto(`${BASE}/admin/plans`, { waitUntil: "networkidle" });
  check("plans page lists the seeded plans", /Standard/.test(await staff.locator("body").innerText()));

  await staff.getByRole("button", { name: /^edit$/i }).first().click();
  // Two plan forms on the page: the inline editor and "Add a plan" at the
  // bottom. The editor comes first in DOM order.
  await staff.getByRole("spinbutton", { name: "Tasks in the pack" }).first().fill("3");
  await staff.getByRole("button", { name: /save plan/i }).first().click();
  await staff.waitForTimeout(2000);

  const edited = await pool.query(`SELECT task_allowance FROM plans WHERE code = 'standard'`);
  check("editing a plan persists", Number(edited.rows[0]?.task_allowance) === 3, String(edited.rows[0]?.task_allowance));

  // And the marketing site follows, with no deploy.
  const pricingAfter = await browser.newContext();
  const pricingPage = await pricingAfter.newPage();
  await pricingPage.goto(`${BASE}/pricing`, { waitUntil: "networkidle" });
  check(
    "the pricing page reflects the edit immediately",
    /\b3\s+tasks, yours until you use them/i.test(await pricingPage.locator("body").innerText()),
  );
  await pricingAfter.close();

  // ── Provision the customer ────────────────────────────────────────
  await staff.goto(`${BASE}/admin/customers`, { waitUntil: "networkidle" });
  const customerEmail = `owner+${Date.now()}@northline.co`;
  // Unique, because the demo seed already contains a "Northline Supply" that is
  // deliberately awaiting payment. Reusing the name put two identical rows on
  // the page, and every locator that reached for "the pending payment" then had
  // a 50/50 chance of confirming the seeded one instead — passing or failing
  // for reasons unrelated to the code.
  const workspaceName = `Northline Supply ${Date.now()}`;

  await staff.getByRole("textbox", { name: "Workspace name" }).fill(workspaceName);
  await staff.getByRole("textbox", { name: "Owner name" }).fill("Priya Raman");
  await staff.getByRole("textbox", { name: "Owner email" }).fill(customerEmail);
  await staff.getByRole("combobox", { name: "Plan" }).selectOption("standard");
  await staff.getByRole("button", { name: /create account/i }).click();

  await waitFor(staff, () => /is set up/i.test(document.body.innerText), { timeout: 20_000 });

  const handover = await staff.locator("body").innerText();
  const password = handover.match(/Password\s*\n?\s*([A-Za-z2-9]{20})/)?.[1] ?? "";
  check("a handover password is generated", password.length === 20, `${password.length} chars`);

  const orgRow = await pool.query(
    `SELECT o.id, o.credits_remaining FROM organizations o
     JOIN memberships m ON m.organization_id = o.id
     JOIN users u ON u.id = m.user_id WHERE u.email = $1`,
    [customerEmail],
  );
  check("the workspace exists with an owner", orgRow.rows.length === 1);
  // Money before work: an account can exist before payment, tasks cannot.
  check("no credits are released before payment", Number(orgRow.rows[0]?.credits_remaining) === 0);

  // ── Record the payment ────────────────────────────────────────────
  await staff.goto(`${BASE}/admin/customers`, { waitUntil: "networkidle" });
  check("the pending payment is surfaced", /awaiting payment/i.test(await staff.locator("body").innerText()));

  // Scoped to THIS customer's row, not .first().
  //
  // The seed deliberately includes a customer awaiting payment, so .first()
  // marked that one paid and left the account under test pending. The
  // assertion below then failed for a reason that had nothing to do with the
  // code — and, worse, the same locator would have PASSED had the two rows
  // been ordered the other way, while testing the wrong account entirely.
  const pendingRow = staff.locator("li").filter({ hasText: workspaceName });
  await pendingRow.getByRole("textbox", { name: "Invoice / reference" }).fill("INV-0001");
  await pendingRow.getByRole("button", { name: /payment received/i }).click();
  await staff.waitForTimeout(2500);

  const afterPayment = await pool.query(
    `SELECT credits_remaining, concurrency_limit, sla_hours, max_task_hours
     FROM organizations WHERE id = $1`,
    [orgRow.rows[0].id],
  );
  check(
    "payment releases the pack and applies the plan's terms",
    Number(afterPayment.rows[0]?.credits_remaining) === 3 &&
      Number(afterPayment.rows[0]?.concurrency_limit) === 1,
    `${afterPayment.rows[0]?.credits_remaining} credits`,
  );

  // ── The customer works ────────────────────────────────────────────
  const custCtx = await browser.newContext();
  const cust = await custCtx.newPage();
  await cust.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await cust.getByRole("textbox", { name: "Work email" }).fill(customerEmail);
  await cust.locator('input[name="password"]').fill(password);
  await cust.getByRole("button", { name: /sign in/i }).click();
  await waitFor(cust, () => /tasks left/i.test(document.body.innerText), { timeout: 20_000 });
  check("the customer can sign in with the handover credentials", true);
  check("the portal shows the remaining allowance", /3\s+tasks left/i.test(await cust.locator("body").innerText()));

  for (let i = 1; i <= 3; i += 1) {
    await cust.getByRole("textbox", { name: "What needs doing?" }).fill(`Task number ${i} from the customer`);
    await cust.getByRole("button", { name: /queue this task/i }).click();
    // The reference is interpolated into the closure rather than passed as an
    // argument, because waitFor takes no argument list — and a string compiled
    // in the page is what the production policy refuses.
    await waitFor(cust, (ref) => document.body.innerText.includes(ref), {
      timeout: 20_000,
      arg: `UNB-00${i}`,
    });
  }
  check("the customer can spend the whole pack", true);

  await cust.reload({ waitUntil: "networkidle" });
  const spent = await cust.locator("body").innerText();
  check(
    "the exhausted pack blocks further submissions",
    /used every task in your pack/i.test(spent) &&
      (await cust.getByRole("textbox", { name: /what needs doing/i }).count()) === 0,
  );
  check("and points at what to do next", /buy another pack|move up a plan|more tasks/i.test(spent));

  // The panel that appears at zero, which is the moment this business model
  // either earns another purchase or loses the customer.
  check(
    "running out shows a route to buying again, not just a refusal",
    /used every task in your pack/i.test(spent),
  );
  check(
    "and says nothing has been lost",
    /nothing expires|nothing has been lost/i.test(spent),
  );
  // Stripe is off on this deployment, so the panel must offer the conversation
  // rather than a Buy button that fails on click.
  const buyButtons = await cust.getByRole("button", { name: /buy another/i }).count();
  const talkLink = await cust.getByRole("link", { name: /talk to us about another pack/i }).count();
  check(
    "with Stripe off it offers the conversation, not a dead Buy button",
    buyButtons === 0 && talkLink === 1,
    `${buyButtons} buy button(s), ${talkLink} contact link(s)`,
  );

  // ── Estimation holds an oversized task ────────────────────────────
  await pool.query(`UPDATE organizations SET max_task_hours = 4 WHERE id = $1`, [orgRow.rows[0].id]);

  await staff.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  check("the review queue lists unestimated work", /waiting on an estimate/i.test(await staff.locator("body").innerText()));

  // Scoped to a task belonging to THIS workspace. The review queue is
  // deliberately cross-customer — it is the team's work list — so .first()
  // estimated whichever seeded task happened to sort to the top and the
  // assertions below then looked for a hold that was placed on someone else's
  // account. Same failure as the payment step: a locator that reads as
  // "the thing" when the page shows several.
  const reviewCard = staff
    .locator("article")
    .filter({ hasText: workspaceName })
    .first();
  await reviewCard.getByRole("spinbutton", { name: "Estimate (hours)" }).fill("12");
  await reviewCard.getByRole("button", { name: /save estimate/i }).click();
  await staff.waitForTimeout(2500);

  const heldRow = await pool.query(
    `SELECT blocked_at, blocked_reason FROM tasks
     WHERE organization_id = $1 AND blocked_at IS NOT NULL`,
    [orgRow.rows[0].id],
  );
  check("an oversized estimate holds the task", heldRow.rows.length === 1);
  check(
    "and the reason names both numbers",
    /12 hours/.test(heldRow.rows[0]?.blocked_reason ?? "") &&
      /4 hours/.test(heldRow.rows[0]?.blocked_reason ?? ""),
    heldRow.rows[0]?.blocked_reason?.slice(0, 80) ?? "",
  );

  // ── Comments, and the internal/customer split ─────────────────────
  await staff.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  await staff.locator("summary", { hasText: /comment/i }).first().click();
  await staff.getByPlaceholder(/which product page/i).first().fill("Which page is this on?");
  await staff.getByRole("button", { name: /^post$/i }).first().click();
  await staff.waitForTimeout(2000);

  const comments = await pool.query(
    `SELECT body, is_internal FROM task_comments ORDER BY created_at`,
  );
  check("a comment is recorded", comments.rows.length >= 1, comments.rows[0]?.body ?? "none");
  check("and is customer-visible by default", comments.rows[0]?.is_internal === false);

  // ── Sell another pack ─────────────────────────────────────────────
  await staff.goto(`${BASE}/admin/customers`, { waitUntil: "networkidle" });
  await staff
    .locator("li")
    .filter({ hasText: workspaceName })
    .getByRole("button", { name: /manage/i })
    .click();
  await staff.getByRole("checkbox", { name: /already paid/i }).check();
  await staff.getByRole("button", { name: /add pack/i }).click();
  await staff.waitForTimeout(2500);

  const topped = await pool.query(`SELECT credits_remaining FROM organizations WHERE id = $1`, [
    orgRow.rows[0].id,
  ]);
  check(
    "selling another pack tops the customer back up",
    Number(topped.rows[0]?.credits_remaining) === 3,
    `${topped.rows[0]?.credits_remaining} credits`,
  );

  // The ledger has to explain every one of those movements.
  const ledger = await pool.query(
    `SELECT type, delta FROM credit_ledger WHERE organization_id = $1 ORDER BY created_at`,
    [orgRow.rows[0].id],
  );
  check(
    "the ledger accounts for every credit",
    ledger.rows.reduce((sum, r) => sum + Number(r.delta), 0) === 3,
    ledger.rows.map((r) => `${r.type}:${r.delta}`).join(" "),
  );

  await staff.screenshot({ path: "/tmp/m6-admin.png", fullPage: true });
  await cust.reload({ waitUntil: "networkidle" });
  await cust.screenshot({ path: "/tmp/m6-portal.png", fullPage: true });
} finally {
  await browser.close();
  await pool.end();
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
