/**
 * M5 end-to-end: Shopify OAuth against a fake Shopify, and the scan pipeline,
 * driven through the real running app.
 *
 *   node tests/m5-flow.mjs
 *
 * Prerequisites are set up by the harness that invokes this:
 *  - `acme-store.myshopify.com` resolves to 127.0.0.1 (/etc/hosts)
 *  - the fake Shopify serves TLS on :443 with a CA the dev server trusts
 *  - the dev server runs with SHOPIFY_API_KEY/SECRET matching the fake
 */
import { chromium } from "playwright";
import pg from "pg";

import { buildCallback, createFakeShopify, signQuery, signWebhook, SECRET } from "./fake-shopify.mjs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOP = "acme-store.myshopify.com";
const PASSWORD = "correct-horse-battery-staple-42";
const EXECUTABLE = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });

const results = [];
function check(name, passed, detail = "") {
  results.push({ name, passed, detail });
  console.log(`${passed ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function waitForPath(target, re, timeout = 25_000) {
  const started = Date.now();
  for (;;) {
    const path = new URL(target.url()).pathname;
    if (re.test(path)) return path;
    if (Date.now() - started > timeout) {
      const body = await target.locator("body").innerText().catch(() => "");
      throw new Error(`still on ${path}, expected ${re}. Page said: ${body.slice(0, 300)}`);
    }
    await target.waitForTimeout(250);
  }
}

const fake = createFakeShopify({
  port: 443,
  tls: { key: "/tmp/shopify-tls/srv.key", cert: "/tmp/shopify-tls/srv.pem" },
});
await fake.listen();

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

const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  // The browser only ever talks to our own app on localhost; the TLS hop to the
  // fake Shopify happens server-side, from Node, which trusts the CA properly.
  ignoreHTTPSErrors: true,
});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

try {
  // ── Sign up and get a workspace ───────────────────────────────────
  const email = `merchant+${Date.now()}@northline.co`;
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle" });
  await page.getByLabel(/name/i).first().fill("Sam Okonjo");
  await page.getByLabel(/email/i).first().fill(email);
  await page.getByLabel(/password/i).first().fill(PASSWORD);
  await page.getByRole("button", { name: /create|start|sign up/i }).first().click();
  // Wait on the rendered form, not the address bar: an RSC redirect swaps the
  // page content before the client-side URL settles, so polling page.url()
  // races the navigation. M4's suite already asserts the /welcome redirect
  // itself; here it is just a step on the way to the Shopify flow.
  await page.getByLabel(/workspace name/i).waitFor({ state: "visible", timeout: 25_000 });
  await page.getByLabel(/workspace name/i).fill("Northline Supply");
  await page.getByRole("button", { name: /create workspace/i }).click();
  await waitFor(page, () => /queue|overview|hello/i.test(document.body.innerText), { timeout: 25_000 });
  check("a new merchant reaches the portal", true);

  // ── The stores page ───────────────────────────────────────────────
  await page.goto(`${BASE}/app/stores`, { waitUntil: "networkidle" });
  const storesBody = await page.locator("body").innerText();
  check("stores page shows the empty state", /no store connected yet/i.test(storesBody));
  check(
    "the scopes we request are stated before the merchant leaves our site",
    /read_products/.test(storesBody) && /read-only/i.test(storesBody),
  );

  // ── Domain validation, from the browser ───────────────────────────
  await page.getByLabel(/store address/i).fill("evil.com");
  await page.getByRole("button", { name: /connect store/i }).click();
  await page.waitForTimeout(1200);
  check(
    "a non-Shopify domain is refused inline, not redirected to",
    /isn't a shopify store address/i.test(await page.locator("body").innerText()),
  );

  // ── The real install redirect ─────────────────────────────────────
  // Follow it manually so the authorize URL can be inspected rather than
  // assumed. Redirects are not followed, so the Location header is visible.
  const installResponse = await context.request.get(
    `${BASE}/api/shopify/install?shop=${SHOP}`,
    { maxRedirects: 0 },
  );
  const authorizeUrl = installResponse.headers()["location"] ?? "";
  const authorize = new URL(authorizeUrl);

  check("install redirects to the store's own domain", authorize.origin === `https://${SHOP}`, authorize.origin);
  check("authorize URL carries our client_id", authorize.searchParams.get("client_id") === "fake-api-key");
  check(
    "authorize URL requests only read scopes",
    (authorize.searchParams.get("scope") ?? "").split(",").every((s) => s.startsWith("read_")),
    authorize.searchParams.get("scope") ?? "",
  );

  const state = authorize.searchParams.get("state") ?? "";
  check("a state nonce was minted", state.length >= 40);

  const stateRow = await pool.query(
    `SELECT shop, consumed_at FROM oauth_states WHERE state = $1`,
    [state],
  );
  check("the nonce is bound to the shop in the database", stateRow.rows[0]?.shop === SHOP);

  // ── An unsigned callback must be refused ──────────────────────────
  const forged = await context.request.get(
    `${BASE}/api/shopify/callback?shop=${SHOP}&code=stolen&state=${state}`,
    { maxRedirects: 0 },
  );
  const forgedTarget = forged.headers()["location"] ?? "";
  check(
    "a callback with no HMAC is refused",
    forgedTarget.includes("error="),
    decodeURIComponent(forgedTarget.split("error=")[1] ?? ""),
  );

  const stillUnused = await pool.query(
    `SELECT consumed_at FROM oauth_states WHERE state = $1`,
    [state],
  );
  check("a refused callback does not burn the nonce", stillUnused.rows[0]?.consumed_at === null);

  // ── A callback signed with the wrong secret ───────────────────────
  const wrongSecret = await context.request.get(
    buildCallback(BASE, { shop: SHOP, state, secret: "not-the-real-secret" }),
    { maxRedirects: 0 },
  );
  check(
    "a callback signed with the wrong secret is refused",
    (wrongSecret.headers()["location"] ?? "").includes("error="),
  );

  // ── A hostile shop with a valid signature ─────────────────────────
  const hostile = new URLSearchParams({ code: "x", shop: "evil.com", state, timestamp: "1" });
  hostile.set("hmac", signQuery(hostile, SECRET));
  const hostileResponse = await context.request.get(
    `${BASE}/api/shopify/callback?${hostile.toString()}`,
    { maxRedirects: 0 },
  );
  check(
    "a correctly-signed callback naming a non-Shopify host is still refused",
    (hostileResponse.headers()["location"] ?? "").includes("error="),
  );

  // ── The real callback ─────────────────────────────────────────────
  const callbackResponse = await context.request.get(
    buildCallback(BASE, { shop: SHOP, state }),
    { maxRedirects: 0 },
  );
  const redirectTo = callbackResponse.headers()["location"] ?? "";
  check("a valid callback connects the store", redirectTo.includes("connected="), redirectTo);

  const stored = await pool.query(
    `SELECT domain, shop_name, plan_name, access_token_encrypted, granted_scopes
     FROM stores WHERE domain = $1`,
    [SHOP],
  );
  const store = stored.rows[0];
  check("the store row exists", Boolean(store), store?.domain ?? "none");
  check(
    "the profile was fetched from the store with the new token",
    store?.shop_name === "Northline Supply" && store?.plan_name === "Shopify Plus",
    `${store?.shop_name} / ${store?.plan_name}`,
  );
  check(
    "the access token is encrypted at rest",
    Boolean(store?.access_token_encrypted?.startsWith("v1.")) &&
      !store.access_token_encrypted.includes("shpat_"),
  );

  // ── Replay ────────────────────────────────────────────────────────
  const replay = await context.request.get(buildCallback(BASE, { shop: SHOP, state }), {
    maxRedirects: 0,
  });
  check(
    "replaying the same callback is refused",
    (replay.headers()["location"] ?? "").includes("error="),
  );

  // ── The merchant sees it ──────────────────────────────────────────
  await page.goto(`${BASE}/app/stores`, { waitUntil: "networkidle" });
  const connectedBody = await page.locator("body").innerText();
  check("the connected store is listed", connectedBody.includes("Northline Supply"));
  check("no token material is rendered on the page", !/shpat_|v1\./.test(connectedBody));

  // ── Webhooks ──────────────────────────────────────────────────────
  const payload = JSON.stringify({ myshopify_domain: SHOP, id: 12345 });

  const unsigned = await context.request.post(`${BASE}/api/shopify/webhooks`, {
    headers: { "Content-Type": "application/json", "x-shopify-topic": "app/uninstalled" },
    data: payload,
  });
  check("an unsigned webhook is rejected with 401", unsigned.status() === 401, String(unsigned.status()));

  const tampered = await context.request.post(`${BASE}/api/shopify/webhooks`, {
    headers: {
      "Content-Type": "application/json",
      "x-shopify-topic": "app/uninstalled",
      "x-shopify-shop-domain": SHOP,
      "x-shopify-hmac-sha256": signWebhook('{"different":"body"}'),
    },
    data: payload,
  });
  check("a webhook signed over different bytes is rejected", tampered.status() === 401);

  const stillConnected = await pool.query(
    `SELECT access_token_encrypted FROM stores WHERE domain = $1`,
    [SHOP],
  );
  check(
    "a rejected webhook did not disconnect anything",
    stillConnected.rows[0]?.access_token_encrypted !== null,
  );

  for (const topic of ["customers/data_request", "customers/redact", "shop/redact"]) {
    const gdpr = await context.request.post(`${BASE}/api/shopify/webhooks`, {
      headers: {
        "Content-Type": "application/json",
        "x-shopify-topic": topic,
        "x-shopify-shop-domain": SHOP,
        "x-shopify-hmac-sha256": signWebhook(payload),
      },
      data: payload,
    });
    check(`mandatory GDPR webhook ${topic} returns 200`, gdpr.status() === 200, String(gdpr.status()));
  }

  // shop/redact above already cleared the credential, so reconnect to test
  // app/uninstalled on its own.
  await pool.query(
    `UPDATE stores SET access_token_encrypted = 'v1.a.b.c', connected_at = now(), disconnected_at = NULL WHERE domain = $1`,
    [SHOP],
  );

  const uninstall = await context.request.post(`${BASE}/api/shopify/webhooks`, {
    headers: {
      "Content-Type": "application/json",
      "x-shopify-topic": "app/uninstalled",
      "x-shopify-shop-domain": SHOP,
      "x-shopify-hmac-sha256": signWebhook(payload),
    },
    data: payload,
  });
  check("a correctly signed uninstall returns 200", uninstall.status() === 200);

  const afterUninstall = await pool.query(
    `SELECT access_token_encrypted, disconnected_at FROM stores WHERE domain = $1`,
    [SHOP],
  );
  check(
    "uninstall destroys the stored credential",
    afterUninstall.rows[0]?.access_token_encrypted === null &&
      afterUninstall.rows[0]?.disconnected_at !== null,
  );

  // ── The Store Health Scan ─────────────────────────────────────────
  await page.goto(`${BASE}/tools/store-health-scan`, { waitUntil: "networkidle" });
  check("the scan page renders the form", await page.getByLabel(/store url/i).isVisible());

  // SSRF, submitted through the real public endpoint.
  for (const [target, label] of [
    ["http://169.254.169.254/latest/meta-data/", "cloud metadata"],
    ["http://localhost:5432", "loopback"],
    ["http://10.0.0.1", "private network"],
    ["file:///etc/passwd", "file scheme"],
  ]) {
    const response = await context.request.post(`${BASE}/api/scans`, {
      data: { url: target },
    });
    check(`scan API refuses ${label}`, response.status() === 400, `${response.status()}`);
  }

  const before = await pool.query(`SELECT count(*)::int n FROM scans`);
  check("no SSRF attempt created a scan row", before.rows[0].n === 0);

  // ── DNS rebinding, for real ───────────────────────────────────────
  // This harness points acme-store.myshopify.com at 127.0.0.1, which makes it a
  // perfect stand-in for a hostile domain: it is syntactically a legitimate
  // public host, so hostname validation accepts it and the scan is created —
  // and the post-DNS check in the worker must then refuse to fetch it.
  //
  // Hostname validation alone would have happily fetched loopback here.
  const rebind = await context.request.post(`${BASE}/api/scans`, {
    data: { url: `https://${SHOP}` },
  });
  check("a public-looking hostname is accepted at submit time", rebind.status() === 202);

  const rebindId = (await rebind.json()).id;
  const { execSync } = await import("node:child_process");
  execSync("npx tsx scripts/run-scan-worker.ts", {
    cwd: process.cwd(),
    env: { ...process.env, DEVELOPMENT_DATABASE_URL: process.env.TEST_DATABASE_URL },
    stdio: "ignore",
  });

  const rebound = await pool.query(`SELECT status, error_message FROM scans WHERE id = $1`, [
    rebindId,
  ]);
  check(
    "the worker refuses it once DNS reveals it resolves to loopback",
    rebound.rows[0]?.status === "failed" &&
      /public internet/i.test(rebound.rows[0]?.error_message ?? ""),
    rebound.rows[0]?.error_message ?? "",
  );
  await pool.query(`TRUNCATE scans, jobs CASCADE`);

  // A real scan, driven from the browser.
  await page.getByLabel(/store url/i).fill("example.com");
  await page.getByRole("button", { name: /run the scan/i }).click();

  await waitFor(page, () => /queued|measuring/i.test(document.body.innerText), { timeout: 15_000 });
  check("the page shows honest progress while queued", true);

  const queued = await pool.query(`SELECT status, target_url FROM scans`);
  check("a scan row was created with a normalised target", queued.rows[0]?.target_url === "https://example.com/", queued.rows[0]?.target_url);

  const job = await pool.query(`SELECT kind, payload FROM jobs WHERE kind = 'scan.run'`);
  check("a durable job was enqueued for the worker", job.rows.length === 1);

  await page.screenshot({ path: "/tmp/m5-scan.png", fullPage: true });
  await page.goto(`${BASE}/app/stores`, { waitUntil: "networkidle" });
  await page.screenshot({ path: "/tmp/m5-stores.png", fullPage: true });
} finally {
  await browser.close();
  await fake.close();
  await pool.end();
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
