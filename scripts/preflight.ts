/**
 * Everything that can be known before a deploy, checked before the deploy.
 *
 * ── What this is for ────────────────────────────────────────────────
 * The failures that hurt on a first deploy are not subtle. They are a missing
 * environment variable, a migration that was never recorded, a config that
 * points at a domain nobody set up. Each one is obvious in hindsight and each
 * one costs a round trip through a build queue to discover.
 *
 * This asks the questions in the order they bite, against the real environment,
 * and says what happens if you ignore each answer. It is deliberately opinionated
 * about severity: only the things that would actually break or expose the app
 * stop a deploy. A missing PageSpeed key does not, because the scan already
 * degrades honestly without it.
 *
 *   npm run preflight                    # check this machine's environment
 *   npm run preflight -- --env-file .env.production
 *
 * Pass --json for machine-readable output in CI.
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  checkEnvironment,
  SEVERITY_ORDER,
  type Severity,
} from "../src/server/env-requirements";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const envFileFlag = args.indexOf("--env-file");
const envFile = envFileFlag >= 0 ? args[envFileFlag + 1] : undefined;

interface Check {
  name: string;
  severity: Severity;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];
const record = (c: Check) => checks.push(c);

// ── 1. Environment ──────────────────────────────────────────────────
function loadEnv(): Record<string, string | undefined> {
  if (!envFile) return process.env;
  if (!existsSync(envFile)) {
    console.error(`--env-file ${envFile} does not exist.`);
    process.exit(2);
  }
  const parsed: Record<string, string> = {};
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    parsed[trimmed.slice(0, eq).trim()] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  return parsed;
}

const env = loadEnv();
const isProduction = (env["NEXT_PUBLIC_APP_ENV"] ?? "") === "production";

for (const finding of checkEnvironment(env, { isProduction })) {
  record({
    name: `env: ${finding.key} — ${finding.problem}`,
    severity: finding.severity,
    ok: false,
    detail: finding.consequence,
  });
}

if (!isProduction) {
  record({
    name: "env: checked against a NON-production environment",
    severity: "optional",
    ok: true,
    detail:
      "NEXT_PUBLIC_APP_ENV is not 'production' here, so production-only " +
      "requirements were skipped. netlify.toml sets it per context, which means " +
      "this run cannot tell you whether the production context is complete — " +
      "point --env-file at the production variables to check those.",
  });
}

// ── 2. Migrations ───────────────────────────────────────────────────
//
// The lockfile is what makes an applied migration immutable. A migration that
// is not in it is a migration whose edits nobody will notice, and this check
// already found two.
try {
  execSync("npx tsx scripts/sync-migrations.ts --check", { stdio: "pipe" });
  const lock = JSON.parse(
    readFileSync(join("netlify", "database", "migrations", ".applied.json"), "utf8"),
  ) as Record<string, string>;
  record({
    name: `migrations: ${Object.keys(lock).length} recorded and intact`,
    severity: "blocker",
    ok: true,
    detail: "",
  });
} catch (error) {
  const output = String((error as { stdout?: Buffer }).stdout ?? error);
  record({
    name: "migrations: integrity check failed",
    severity: "blocker",
    ok: false,
    detail:
      output.trim() +
      "\nNetlify applies migrations before publishing a deploy, so this fails " +
      "the deploy rather than corrupting the database — but it fails it after " +
      "a full build.",
  });
}

// A migration directory with no migration.sql is applied as nothing at all.
const migrationsDir = join("netlify", "database", "migrations");
if (existsSync(migrationsDir)) {
  const empty = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => !existsSync(join(migrationsDir, e.name, "migration.sql")))
    .map((e) => e.name);
  if (empty.length > 0) {
    record({
      name: `migrations: ${empty.length} directory without a migration.sql`,
      severity: "blocker",
      ok: false,
      detail: `${empty.join(", ")} — these apply as nothing and the deploy still succeeds.`,
    });
  }
}

// ── 3. netlify.toml ─────────────────────────────────────────────────
const toml = existsSync("netlify.toml") ? readFileSync("netlify.toml", "utf8") : "";

if (!toml) {
  record({
    name: "netlify.toml: missing",
    severity: "blocker",
    ok: false,
    detail: "No build command, no headers, no scheduled functions.",
  });
} else {
  const siteUrl = /NEXT_PUBLIC_SITE_URL\s*=\s*"([^"]+)"/.exec(toml)?.[1];
  record({
    name: `netlify.toml: production site URL is ${siteUrl ?? "(unset)"}`,
    severity: "feature",
    ok: Boolean(siteUrl),
    detail: siteUrl
      ? "Canonical URLs, the sitemap and OG tags use this. It must be a domain " +
        "actually attached to the Netlify site — if the custom domain is not set " +
        "up yet, every canonical URL points somewhere that does not resolve."
      : "Canonical URLs and the sitemap will point at the deploy host.",
  });

  // Scheduled functions are how queued work drains. Without them the outbox
  // fills and nothing sends, which looks like the app working.
  for (const fn of ["scan-sweeper", "notify-worker"]) {
    const scheduled = new RegExp(`\\[functions\\."${fn}"\\][\\s\\S]{0,120}?schedule`).test(toml);
    record({
      name: `netlify.toml: ${fn} is scheduled`,
      severity: "feature",
      ok: scheduled,
      detail: scheduled
        ? ""
        : `Nothing drains ${fn === "notify-worker" ? "the notification outbox" : "the scan queue"}. ` +
          "The app looks fine and the work never happens.",
    });
  }

  const fnDir = /directory\s*=\s*"([^"]+)"/.exec(toml)?.[1];
  if (fnDir) {
    const present = existsSync(fnDir) ? readdirSync(fnDir) : [];
    for (const fn of ["scan-worker-background", "scan-sweeper", "notify-worker"]) {
      const found = present.some((f) => f.startsWith(fn));
      record({
        name: `functions: ${fn} exists on disk`,
        severity: "feature",
        ok: found,
        detail: found ? "" : `netlify.toml configures ${fn} but ${fnDir}/ has no such file.`,
      });
    }
  }
}

// ── 4. The build ────────────────────────────────────────────────────
//
// Last, because it is the slow one, and because everything above tells you
// whether it is worth running.
if (!args.includes("--skip-build")) {
  try {
    execSync("npx next build", { stdio: "pipe", timeout: 600_000 });
    record({ name: "build: production build succeeds", severity: "blocker", ok: true, detail: "" });
  } catch (error) {
    const out = String((error as { stdout?: Buffer }).stdout ?? "");
    record({
      name: "build: production build FAILED",
      severity: "blocker",
      ok: false,
      detail: out.split("\n").slice(-25).join("\n"),
    });
  }
}

// ── Report ──────────────────────────────────────────────────────────
const failures = checks.filter((c) => !c.ok);
const blockers = failures.filter((c) => c.severity === "blocker");

if (asJson) {
  console.log(JSON.stringify({ checks, blockers: blockers.length }, null, 2));
} else {
  const LABEL: Record<Severity, string> = {
    blocker: "BLOCKER ",
    feature: "BREAKS  ",
    degraded: "DEGRADED",
    optional: "note    ",
  };

  console.log("\n── Deploy preflight ───────────────────────────────────\n");

  for (const c of checks.filter((x) => x.ok)) console.log(`  ok        ${c.name}`);

  if (failures.length > 0) console.log("");
  for (const c of [...failures].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  )) {
    console.log(`  ${LABEL[c.severity]}  ${c.name}`);
    for (const line of c.detail.split("\n")) {
      if (line.trim()) console.log(`              ${line.trim()}`);
    }
    console.log("");
  }

  console.log(
    blockers.length === 0
      ? failures.length === 0
        ? "Ready to deploy.\n"
        : `Deployable. ${failures.length} thing(s) will not work — listed above.\n`
      : `NOT ready. ${blockers.length} blocker(s).\n`,
  );
}

process.exit(blockers.length === 0 ? 0 : 1);
