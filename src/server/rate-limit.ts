import { sql } from "drizzle-orm";

import { db } from "@/db/client";

/**
 * Rate limiting for the public, unauthenticated endpoints.
 *
 * ── What was unprotected ────────────────────────────────────────────
 * Two write surfaces are open to anyone: `POST /api/scans`, which makes our
 * servers fetch a URL a stranger chose, and the contact form, which is now the
 * only route into the product and therefore the only thing standing between the
 * sales pipeline and a flood of noise.
 *
 * Both had *some* protection — scans cap repeats of the same target, leads
 * suppress duplicates from one address — but neither had a ceiling on the
 * caller. One person could scan a thousand different targets, or file a hundred
 * enquiries under a hundred addresses.
 *
 * ── Why the counter is a single statement ───────────────────────────
 * `INSERT … ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count` is
 * atomic. Reading the count and then writing it back is the same check-then-act
 * race that M4 proved does not hold here, and a limiter that undercounts under
 * load is a limiter that fails exactly when it matters.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Requests used in the current window, including this one. */
  used: number;
  limit: number;
  /** Seconds until the window rolls over. For a Retry-After header. */
  retryAfterSeconds: number;
}

/**
 * Count this request against a bucket.
 *
 * The window is fixed and derived from the clock, so every caller in the same
 * window shares one row and the count is one increment rather than an aggregate
 * over a row per request.
 */
export async function consumeRateLimit(input: {
  /** What is being limited, e.g. "scan" or "lead". */
  kind: string;
  /** Who — an IP, or any stable identifier the caller can derive. */
  identifier: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  const bucket = `${input.kind}:${input.identifier}`;

  const rows = await db.execute<{ count: number; window_start: Date }>(sql`
    INSERT INTO rate_limits (bucket, window_start, count)
    VALUES (
      ${bucket},
      -- to_timestamp(floor(epoch / window) * window) is the fixed window this
      -- request falls into. Doing it in SQL keeps every instance agreed on
      -- where the boundary is, rather than trusting each server's clock drift.
      to_timestamp(floor(extract(epoch FROM now()) / ${input.windowSeconds}) * ${input.windowSeconds}),
      1
    )
    ON CONFLICT (bucket, window_start) DO UPDATE
      SET count = rate_limits.count + 1, updated_at = now()
    RETURNING count, window_start
  `);

  const row = first<{ count: number; window_start: Date }>(rows);
  const used = Number(row?.count ?? 1);

  const windowStart =
    row?.window_start instanceof Date ? row.window_start : new Date(String(row?.window_start));
  const elapsed = (Date.now() - windowStart.getTime()) / 1000;
  const retryAfterSeconds = Math.max(1, Math.ceil(input.windowSeconds - elapsed));

  return {
    allowed: used <= input.limit,
    used,
    limit: input.limit,
    retryAfterSeconds,
  };
}

/**
 * The caller's address, as well as it can be known behind a proxy.
 *
 * ── Why this is not simply trusted ──────────────────────────────────
 * `x-forwarded-for` is a client-settable header. Anywhere except behind a proxy
 * that overwrites it, an attacker sets it per request and every request lands
 * in its own bucket, which defeats the limiter completely while looking like it
 * works.
 *
 * Netlify sets `x-nf-client-connection-ip` itself and strips any incoming copy,
 * so that is preferred. The forwarded header is a fallback for local
 * development, and only its FIRST entry is used — the rest are appended by
 * intermediaries and the last ones are attacker-controlled.
 *
 * A request with no usable address falls into one shared bucket rather than
 * being waved through: better to rate-limit an unknown caller collectively than
 * to hand out an exemption for omitting a header.
 */
export function clientIdentifier(headers: Headers): string {
  const netlify = headers.get("x-nf-client-connection-ip");
  if (netlify) return netlify.trim();

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  const real = headers.get("x-real-ip");
  if (real) return real.trim();

  return "unknown";
}

/** Housekeeping. A rolled-over window is dead weight. */
export async function purgeExpiredWindows(olderThanSeconds = 86_400): Promise<void> {
  await db.execute(sql`
    DELETE FROM rate_limits
    WHERE window_start < now() - make_interval(secs => ${olderThanSeconds})
  `);
}

function first<T>(rows: unknown): T | undefined {
  const result = (rows as { rows?: unknown[] }).rows ?? rows;
  return (Array.isArray(result) ? (result[0] as T | undefined) : undefined) ?? undefined;
}
