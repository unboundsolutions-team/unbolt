import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { enqueue } from "@/server/jobs";

import { buildFindings, type Finding, type ScanMetrics } from "./findings";
import { AuditUnavailableError, type AuditProvider } from "./provider";
import { parseScanTarget, UnsafeTargetError } from "./target";

/**
 * The scan lifecycle.
 *
 * queued → running → complete | failed, with the row created synchronously so
 * `POST /api/scans` can return an id inside the 10s function budget while the
 * actual audit runs in a background function.
 */

export const SCAN_JOB_KIND = "scan.run";

export interface ScanView {
  id: string;
  status: "queued" | "running" | "complete" | "failed";
  targetUrl: string;
  performanceScore: number | null;
  accessibilityScore: number | null;
  seoScore: number | null;
  bestPracticesScore: number | null;
  findings: Finding[];
  metrics: ScanMetrics | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export class ScanRateLimitError extends Error {
  constructor(readonly publicMessage: string) {
    super(publicMessage);
    this.name = "ScanRateLimitError";
  }
}

/**
 * How much scanning one visitor gets.
 *
 * The endpoint is public and unauthenticated, and each request makes our
 * infrastructure fetch a URL a stranger chose. Without a cap this is a free
 * traffic amplifier pointed at whoever the attacker likes — and it burns the
 * PageSpeed quota that paying customers depend on.
 *
 * Enforced in the database rather than in memory: Netlify functions are
 * per-invocation, so an in-process counter resets constantly and protects
 * nothing.
 */
export const RATE_WINDOW_MINUTES = 10;
export const MAX_SCANS_PER_TARGET = 3;

export async function createScan(input: {
  rawUrl: string;
  organizationId?: string | undefined;
  storeId?: string | undefined;
  leadEmail?: string | undefined;
}): Promise<{ scanId: string; targetUrl: string }> {
  // Throws UnsafeTargetError for anything that is not a public http(s) origin.
  const target = parseScanTarget(input.rawUrl);
  const targetUrl = target.toString();

  await assertWithinRateLimit(targetUrl);

  const rows = await db.execute<{ id: string }>(sql`
    INSERT INTO scans (target_url, organization_id, store_id, lead_email, status)
    VALUES (
      ${targetUrl},
      ${input.organizationId ?? null}::uuid,
      ${input.storeId ?? null}::uuid,
      ${input.leadEmail ?? null},
      'queued'
    )
    RETURNING id
  `);

  const result = (rows as unknown as { rows?: unknown[] }).rows ?? rows;
  const created = (Array.isArray(result) ? result[0] : undefined) as { id: string } | undefined;
  if (!created) throw new Error("Scan insert returned no row.");

  await enqueue({ kind: SCAN_JOB_KIND, payload: { scanId: created.id }, maxAttempts: 2 });

  return { scanId: created.id, targetUrl };
}

async function assertWithinRateLimit(targetUrl: string): Promise<void> {
  const rows = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM scans
    WHERE target_url = ${targetUrl}
      AND created_at > now() - make_interval(mins => ${RATE_WINDOW_MINUTES})
  `);

  const result = (rows as unknown as { rows?: unknown[] }).rows ?? rows;
  const row = (Array.isArray(result) ? result[0] : undefined) as { n: number } | undefined;

  if ((row?.n ?? 0) >= MAX_SCANS_PER_TARGET) {
    throw new ScanRateLimitError(
      "That store was scanned a moment ago. Results don't change that fast — " +
        "try again in a few minutes.",
    );
  }
}

/**
 * Run a queued scan to completion.
 *
 * Takes its provider as an argument so the worker, the tests and a future
 * vendor swap all drive the same code. Never throws for an audit failure: a
 * failed scan is a row with a reason, which is what the polling endpoint needs
 * in order to say something true to the visitor.
 */
export async function runScan(scanId: string, provider: AuditProvider): Promise<void> {
  const claimed = await db.execute<{ target_url: string }>(sql`
    UPDATE scans SET status = 'running', started_at = now()
    WHERE id = ${scanId} AND status = 'queued'
    RETURNING target_url
  `);

  const claimedRows = (claimed as unknown as { rows?: unknown[] }).rows ?? claimed;
  const row = (Array.isArray(claimedRows) ? claimedRows[0] : undefined) as
    | { target_url: string }
    | undefined;

  // Already running or finished — a duplicate delivery, not an error.
  if (!row) return;

  try {
    // Re-validated on the way out, not just on the way in. The row has been
    // sitting in a queue, and the value that gets fetched must be the value
    // that was checked.
    const target = parseScanTarget(row.target_url);
    const result = await provider.run(target);
    const findings = buildFindings(result.metrics);

    await db.execute(sql`
      UPDATE scans SET
        status = 'complete',
        performance_score = ${result.performanceScore ?? null},
        accessibility_score = ${result.accessibilityScore ?? null},
        seo_score = ${result.seoScore ?? null},
        best_practices_score = ${result.bestPracticesScore ?? null},
        metrics = ${JSON.stringify(result.metrics)}::jsonb,
        findings = ${JSON.stringify(findings)}::jsonb,
        completed_at = now()
      WHERE id = ${scanId}
    `);
  } catch (error) {
    const publicMessage =
      error instanceof AuditUnavailableError || error instanceof UnsafeTargetError
        ? error.publicMessage
        : "Something went wrong while scanning. Try again in a few minutes.";

    // The full error goes to the log; the row gets the sentence a visitor sees.
    console.error(`[scan ${scanId}]`, error);

    await db.execute(sql`
      UPDATE scans SET status = 'failed', error_message = ${publicMessage}, completed_at = now()
      WHERE id = ${scanId}
    `);
  }
}

/** What the polling endpoint returns. */
export async function getScan(scanId: string): Promise<ScanView | null> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    SELECT id, status, target_url, performance_score, accessibility_score,
           seo_score, best_practices_score, metrics, findings, error_message,
           created_at, completed_at
    FROM scans WHERE id = ${scanId}
  `);

  const result = (rows as unknown as { rows?: unknown[] }).rows ?? rows;
  const row = (Array.isArray(result) ? result[0] : undefined) as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    id: String(row["id"]),
    status: row["status"] as ScanView["status"],
    targetUrl: String(row["target_url"]),
    performanceScore: numeric(row["performance_score"]),
    accessibilityScore: numeric(row["accessibility_score"]),
    seoScore: numeric(row["seo_score"]),
    bestPracticesScore: numeric(row["best_practices_score"]),
    findings: (row["findings"] as Finding[] | null) ?? [],
    metrics: (row["metrics"] as ScanMetrics | null) ?? null,
    errorMessage: row["error_message"] ? String(row["error_message"]) : null,
    createdAt: toIso(row["created_at"]),
    completedAt: row["completed_at"] ? toIso(row["completed_at"]) : null,
  };
}

function numeric(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
