/**
 * A fake Shopify, faithful enough to be worth testing against.
 *
 * There is no Shopify Partner account yet (§10.7 of the brief), so the real
 * OAuth flow cannot be exercised. The choice is between shipping the
 * integration unverified and building something that behaves like Shopify for
 * the parts that matter. This is the second option.
 *
 * What it reproduces exactly, because these are what our code depends on:
 *  - the authorize → redirect-with-signed-callback shape
 *  - HMAC over sorted query params, hex, with `hmac` excluded
 *  - HMAC over the raw webhook body, base64
 *  - the access_token exchange response shape
 *  - the shop.json profile response
 *
 * What it does not reproduce: consent UI, scopes negotiation, rate limits.
 * Those do not change how our handlers behave.
 *
 *   node tests/fake-shopify.mjs   # standalone, port 4001
 */
import { createHmac } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync } from "node:fs";

export const SECRET = process.env.FAKE_SHOPIFY_SECRET ?? "fake-shopify-secret-at-least-32-chars";
export const API_KEY = process.env.FAKE_SHOPIFY_KEY ?? "fake-api-key";

/** Sign a query string the way Shopify does: sorted, hmac excluded, hex. */
export function signQuery(params, secret = SECRET) {
  const message = [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

/** Sign a webhook body the way Shopify does: raw bytes, base64. */
export function signWebhook(rawBody, secret = SECRET) {
  return createHmac("sha256", secret).update(Buffer.from(rawBody, "utf8")).digest("base64");
}

/**
 * Build the callback URL Shopify would send the merchant to.
 *
 * Exported so a test can drive the callback directly — including with a
 * deliberately broken signature, which is the case that matters most.
 */
export function buildCallback(appOrigin, { shop, code = "fake-auth-code", state, secret = SECRET }) {
  const params = new URLSearchParams({
    code,
    shop,
    state,
    timestamp: String(Math.floor(Date.now() / 1000)),
    host: Buffer.from(`${shop}/admin`).toString("base64"),
  });
  params.set("hmac", signQuery(params, secret));
  return `${appOrigin}/api/shopify/callback?${params.toString()}`;
}

/**
 * The server. Answers the two endpoints our code calls on a store's origin.
 *
 * Requests reach it because the harness points `acme-store.myshopify.com` at
 * 127.0.0.1 in /etc/hosts and serves this over real TLS on 443, with a CA the
 * app trusts via NODE_EXTRA_CA_CERTS.
 *
 * That indirection is deliberate. The alternative — an env var overriding the
 * store origin — would mean shipping a supported way to redirect a token
 * exchange somewhere else, which is a backdoor, not a test seam. This way the
 * URL the app builds during the test is byte-identical to the one it builds in
 * production, the `*.myshopify.com` validation is fully in force, and nothing
 * in src/ knows a test is running.
 */
export function createFakeShopify({ port = 4001, secret = SECRET, tls = null } = {}) {
  const issued = new Set();

  // Served over real TLS on 443 when a cert is supplied, so the app can reach
  // it at https://<shop>.myshopify.com with no production code changed — the
  // URL it builds in the test is byte-identical to the one it builds in
  // production. A plain-HTTP fake would have required an origin override in
  // src/, i.e. a way to redirect a token exchange, which is not a thing that
  // should exist.
  const handler = (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    if (url.pathname === "/admin/oauth/access_token" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        let parsed = {};
        try {
          parsed = JSON.parse(body);
        } catch {
          /* fall through to the 400 below */
        }

        // Shopify rejects an exchange with the wrong client secret. Reproducing
        // that is what proves our error path is real rather than decorative.
        if (parsed.client_secret !== secret || parsed.client_id !== API_KEY) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_client" }));
          return;
        }
        if (!parsed.code) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_request" }));
          return;
        }

        const token = `shpat_fake_${Math.random().toString(36).slice(2, 10)}`;
        issued.add(token);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            access_token: token,
            scope: "read_products,read_themes,read_orders,read_script_tags",
          }),
        );
      });
      return;
    }

    if (url.pathname === "/admin/api/2025-01/shop.json") {
      const token = req.headers["x-shopify-access-token"];
      if (!token || !issued.has(String(token))) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ errors: "Invalid API key or access token" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          shop: {
            name: "Northline Supply",
            email: "founder@northline.co",
            plan_display_name: "Shopify Plus",
            currency: "USD",
          },
        }),
      );
      return;
    }

    // The consent screen. A real merchant would click Approve here; the test
    // drives the callback directly instead.
    if (url.pathname === "/admin/oauth/authorize") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!doctype html><title>Fake Shopify consent</title><h1>Approve?</h1>`);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  };

  const server = tls
    ? createHttpsServer(
        { key: readFileSync(tls.key), cert: readFileSync(tls.cert) },
        handler,
      )
    : createHttpServer(handler);

  return {
    server,
    issuedTokens: issued,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => resolve(port));
      }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// Standalone mode, so the fake can be run alongside `npm run dev` by hand.
if (import.meta.url === `file://${process.argv[1]}`) {
  const fake = createFakeShopify();
  await fake.listen();
  console.log(`fake shopify listening on http://127.0.0.1:4001 (secret: ${SECRET})`);
}
