/**
 * Speak Neon's SQL-over-HTTP protocol in front of a local Postgres.
 *
 * ── The problem this removes ────────────────────────────────────────
 * `next start` forces NODE_ENV=production, and src/db/client.ts honours
 * DEVELOPMENT_DATABASE_URL only outside production — deliberately, so no stray
 * variable can point live traffic at a dev box. Correct, and it meant the
 * production build could not serve a single database-backed route locally.
 *
 * That caveat had started to shape the work: the CSP check, the no-JS check and
 * the Lighthouse gate all had to skip `/`, `/pricing` and `/contact`, which are
 * the three pages that matter most. Checks that cannot see the important pages
 * are checks that will eventually miss something on them.
 *
 * ── Why a protocol proxy rather than a switch in the app ────────────
 * The alternative was an environment variable that relaxes the guard for
 * testing. That is a backdoor, not a test seam: the thing it disables is the
 * exact thing protecting production, and it would live in the shipped code.
 *
 * Instead, nothing in src/ changes and nothing in it knows this exists. The
 * driver's own endpoint rule — host.replace(/^[^.]+\./, "api.") + "/sql" —
 * means a connection string pointing at db.unbolt.local makes it request
 * https://api.unbolt.local/sql. Map that name to 127.0.0.1, serve real TLS with
 * a CA the process trusts, and the production code path is byte-identical to
 * the one that runs on Netlify.
 *
 *   node scripts/neon-http-proxy.mjs --setup     # hosts entry + certificates
 *   node scripts/neon-http-proxy.mjs             # run it
 *
 * Then:
 *   NETLIFY_DATABASE_URL=postgresql://unbolt@db.unbolt.local/unbolt_dev \
 *   NODE_EXTRA_CA_CERTS=/tmp/unbolt-ca/ca.pem \
 *   NEXT_PUBLIC_APP_ENV=production npx next start
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { createServer } from "node:https";

import pg from "pg";

const HOST = "api.unbolt.local";
const CERT_DIR = process.env.UNBOLT_CERT_DIR ?? "/tmp/unbolt-ca";
const PORT = Number(process.env.PROXY_PORT ?? 443);

// ── Setup ───────────────────────────────────────────────────────────
if (process.argv.includes("--setup")) {
  mkdirSync(CERT_DIR, { recursive: true });

  if (!existsSync(`${CERT_DIR}/ca.pem`)) {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -nodes -days 365 ` +
        `-keyout ${CERT_DIR}/ca.key -out ${CERT_DIR}/ca.pem ` +
        `-subj "/CN=Unbolt Local Test CA"`,
      { stdio: "pipe" },
    );
    // A SAN is mandatory: Node stopped falling back to the subject CN years
    // ago, and without it the handshake fails with an error that says nothing
    // about SANs.
    execSync(
      `openssl req -newkey rsa:2048 -nodes -keyout ${CERT_DIR}/server.key ` +
        `-out ${CERT_DIR}/server.csr -subj "/CN=${HOST}" && ` +
        `printf "subjectAltName=DNS:${HOST}\\nbasicConstraints=CA:FALSE\\n" > ${CERT_DIR}/ext.cnf && ` +
        `openssl x509 -req -in ${CERT_DIR}/server.csr -CA ${CERT_DIR}/ca.pem ` +
        `-CAkey ${CERT_DIR}/ca.key -CAcreateserial -days 365 ` +
        `-out ${CERT_DIR}/server.pem -extfile ${CERT_DIR}/ext.cnf`,
      { stdio: "pipe", shell: "/bin/bash" },
    );
    console.log(`certificates → ${CERT_DIR}`);
  } else {
    console.log(`certificates already present in ${CERT_DIR}`);
  }

  const hosts = readFileSync("/etc/hosts", "utf8");
  if (!hosts.includes(HOST)) {
    appendFileSync("/etc/hosts", `\n127.0.0.1 ${HOST}\n`);
    console.log(`/etc/hosts → 127.0.0.1 ${HOST}`);
  } else {
    console.log(`/etc/hosts already maps ${HOST}`);
  }

  console.log(`\nNODE_EXTRA_CA_CERTS=${CERT_DIR}/ca.pem`);
  process.exit(0);
}

// ── The proxy ───────────────────────────────────────────────────────
const pool = new pg.Pool({
  connectionString:
    process.env.PROXY_TARGET ?? "postgres://unbolt@127.0.0.1:55432/unbolt_dev",
  max: 12,
});

/**
 * The driver sends `Neon-Raw-Text-Output: true` and parses values itself using
 * each column's dataTypeID. So this must NOT parse them — returning a JS Date
 * where the client expects the text form produces corruption that only shows up
 * on some column types, which is the worst way to find a bug like this.
 */
const rawText = { getTypeParser: () => (v) => v };

async function runQuery(client, { query, params }) {
  const result = await client.query({
    text: query,
    values: params ?? [],
    rowMode: "array", // Neon-Array-Mode: true
    types: rawText,
  });
  return {
    command: result.command,
    rowCount: result.rowCount,
    rows: result.rows,
    fields: result.fields.map((f) => ({
      name: f.name,
      dataTypeID: f.dataTypeID,
      tableID: f.tableID,
      columnID: f.columnID,
      dataTypeSize: f.dataTypeSize,
      dataTypeModifier: f.dataTypeModifier,
      format: f.format,
    })),
  };
}

const server = createServer(
  { key: readFileSync(`${CERT_DIR}/server.key`), cert: readFileSync(`${CERT_DIR}/server.pem`) },
  (req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/sql")) {
      res.writeHead(404).end();
      return;
    }

    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      let client;
      try {
        const payload = JSON.parse(body);
        client = await pool.connect();

        // A batch arrives as an array and is expected to be transactional.
        // Postgres does support that here — this is a real connection, not the
        // HTTP-per-statement path the app itself is written to avoid.
        if (Array.isArray(payload.queries)) {
          const results = [];
          await client.query("BEGIN");
          try {
            for (const q of payload.queries) results.push(await runQuery(client, q));
            await client.query("COMMIT");
          } catch (error) {
            await client.query("ROLLBACK");
            throw error;
          }
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ results }));
          return;
        }

        const result = await runQuery(client, payload);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (error) {
        // Shape the error the way Neon does, so the driver surfaces the real
        // Postgres message rather than "unexpected response".
        res.writeHead(400, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            message: error.message,
            code: error.code,
            severity: error.severity,
            detail: error.detail,
            hint: error.hint,
            position: error.position,
          }),
        );
      } finally {
        client?.release();
      }
    });
  },
);

server.listen(PORT, () => {
  console.log(`neon-http-proxy  https://${HOST}:${PORT}/sql  →  local Postgres`);
});
