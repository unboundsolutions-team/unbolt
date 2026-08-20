-- A rate limiter that survives a serverless request.
--
-- ── Why this is in Postgres and not Redis ───────────────────────────
-- §6 of the brief lists Upstash Redis, and for a high-volume limiter it would
-- be the right tool. These are not high-volume endpoints: a scan submission and
-- a contact-form post. Adding a fourth SaaS dependency, its credentials and its
-- failure mode for two forms is a worse trade than one table — the same
-- reasoning the addendum used to choose Background Functions over a queue
-- service.
--
-- ── Why it cannot be in memory ──────────────────────────────────────
-- Netlify functions are per-invocation. An in-process counter resets constantly
-- and protects nothing, which is the specific way naive rate limiting fails on
-- serverless: it looks correct locally, under one warm process, and does
-- essentially nothing in production.
--
-- Fixed window rather than sliding: a sliding window needs a row per request,
-- and for "no more than N in ten minutes" the extra precision buys nothing that
-- justifies the write volume.

CREATE TABLE rate_limits (
  -- What is being limited and by whom, e.g. 'scan:203.0.113.4'. The caller
  -- builds it; this table has no opinion about the scheme.
  bucket text NOT NULL,
  -- Truncated to the window size, so all requests in one window share a row and
  -- the count is a single atomic increment rather than an aggregate.
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (bucket, window_start)
);

-- Old windows are dead weight the moment they roll over. Indexed so the sweep
-- is cheap enough to run alongside normal traffic.
CREATE INDEX rate_limits_sweep_idx ON rate_limits (window_start);

COMMENT ON TABLE rate_limits IS
  'Fixed-window request counters. Incremented atomically via INSERT … ON '
  'CONFLICT DO UPDATE, which is race-safe without a transaction — the same '
  'property the credit balance relies on.';
