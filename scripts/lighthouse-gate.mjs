/**
 * Run the Lighthouse budget in lighthouserc.json and report every miss.
 *
 * ── Why not `lhci autorun` ──────────────────────────────────────────
 * lhci launches its own Chrome and cannot be told to pass --no-sandbox to it in
 * a container running as root, so it fails at "Unable to connect to Chrome"
 * before measuring anything. Rather than let the gate stay theoretical — it had
 * never once been executed — this drives Lighthouse directly with the same
 * thresholds, read from the same file, so there is one budget and not two.
 * `lhci autorun` still works unchanged in an environment where it can launch.
 *
 * ── What it will not do ─────────────────────────────────────────────
 * It will not run against a dev server. A dev build is unminified, ships HMR
 * and compiles routes on demand; scoring it produces numbers that mean nothing
 * and would have to be ignored, and a budget everybody ignores is not a budget.
 * The Neon HTTP proxy (scripts/neon-http-proxy.mjs) is what makes a real
 * production build serveable locally, including the database-backed pages this
 * budget actually targets.
 *
 *   node scripts/neon-http-proxy.mjs &      # once
 *   npx next build && npx next start
 *   npm run test:lighthouse
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const config = JSON.parse(readFileSync("lighthouserc.json", "utf8")).ci;
const urls = process.env.LH_URLS?.split(",") ?? config.collect.url;
const assertions = config.assert.assertions;
const CHROME =
  process.env.CHROME_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const out = mkdtempSync(join(tmpdir(), "lh-"));
let failures = 0;
let warnings = 0;

for (const url of urls) {
  const file = join(out, `${encodeURIComponent(url)}.json`);

  execFileSync(
    "npx",
    [
      "lighthouse",
      url,
      `--preset=${config.collect.settings?.preset ?? "desktop"}`,
      "--output=json",
      `--output-path=${file}`,
      "--quiet",
      "--chrome-flags=--no-sandbox --disable-dev-shm-usage --headless=new --disable-gpu",
    ],
    {
      stdio: "pipe",
      // CHROME_PATH must reach the child: Lighthouse resolves the binary
      // itself and there is no Chrome on PATH in this container. NO_PROXY
      // keeps the sandbox's HTTP proxy from intercepting localhost.
      env: { ...process.env, CHROME_PATH: CHROME, NO_PROXY: "*", no_proxy: "*" },
    },
  );

  const report = JSON.parse(readFileSync(file, "utf8"));
  console.log(`\n${url}`);

  for (const [key, [level, limit]] of Object.entries(assertions)) {
    const isCategory = key.startsWith("categories:");
    const name = isCategory ? key.slice("categories:".length) : key;

    const actual = isCategory
      ? report.categories[name]?.score
      : report.audits[name]?.numericValue;

    if (actual === undefined || actual === null) {
      console.log(`  ?     ${name} — not measured`);
      continue;
    }

    const ok =
      limit.minScore !== undefined
        ? actual >= limit.minScore
        : actual <= limit.maxNumericValue;

    const shown = isCategory ? actual.toFixed(2) : Math.round(actual);
    const bound =
      limit.minScore !== undefined ? `min ${limit.minScore}` : `max ${limit.maxNumericValue}`;

    if (ok) {
      console.log(`  ok    ${name}: ${shown} (${bound})`);
    } else if (level === "warn") {
      warnings += 1;
      console.log(`  warn  ${name}: ${shown} exceeds ${bound}`);
    } else {
      failures += 1;
      console.log(`  FAIL  ${name}: ${shown} misses ${bound}`);
    }
  }
}

console.log(
  `\n${failures === 0 ? `PASS${warnings ? ` — ${warnings} warning(s)` : ""}` : `FAIL — ${failures} budget miss(es)`}\n`,
);
process.exit(failures === 0 ? 0 : 1);
