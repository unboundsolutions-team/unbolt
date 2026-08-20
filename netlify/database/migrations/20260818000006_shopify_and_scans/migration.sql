-- M5 — Shopify OAuth and the Store Health Scan.

-- ── Store connections ───────────────────────────────────────────────

-- The token column is renamed rather than reused. `access_token` held a
-- plaintext token in the M0 shape; the new name makes it impossible for old
-- code to read the new column and get a ciphertext it would send to Shopify as
-- a bearer credential, and impossible for new code to silently read a plaintext
-- left behind by the old shape.
ALTER TABLE stores DROP COLUMN access_token;

ALTER TABLE stores
  ADD COLUMN access_token_encrypted text,
  -- What the merchant actually granted, which can be narrower than what we
  -- asked for. Stored so a feature can say "reconnect to grant X" instead of
  -- surfacing a raw 403 from Shopify as though it were our bug.
  ADD COLUMN granted_scopes text,
  ADD COLUMN shop_name text,
  ADD COLUMN shop_email text,
  ADD COLUMN plan_name text,
  ADD COLUMN currency text,
  ADD COLUMN disconnected_at timestamptz,
  ADD COLUMN last_verified_at timestamptz,
  ADD COLUMN connected_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- A connected store must hold a credential; a disconnected one must not.
-- This is what makes "we deleted your token" checkable rather than a claim.
ALTER TABLE stores ADD CONSTRAINT stores_token_ck CHECK (
  (connected_at IS NOT NULL AND disconnected_at IS NULL AND access_token_encrypted IS NOT NULL)
  OR (connected_at IS NULL OR disconnected_at IS NOT NULL)
);

-- One myshopify domain can only be actively connected to ONE organisation.
-- Without this, organisation B connects a store organisation A already owns and
-- immediately sees its tasks and scans. Partial, so a disconnected row stays as
-- history and the same shop can later be connected by someone else.
CREATE UNIQUE INDEX stores_active_domain_key
  ON stores (lower(domain))
  WHERE connected_at IS NOT NULL AND disconnected_at IS NULL;

-- ── OAuth state nonces ──────────────────────────────────────────────
--
-- The CSRF defence for the install flow. A nonce is minted when the merchant
-- starts, and the callback is only honoured if it matches one that is unused,
-- unexpired, and belongs to the organisation the callback claims.
--
-- In its own table rather than a cookie because the callback arrives as a
-- top-level cross-site GET from Shopify: a SameSite=Lax cookie is sent on that
-- navigation, but a Strict one is not, and relying on cookie semantics that
-- subtle for a CSRF defence is how these flows break silently.
CREATE TABLE oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state text NOT NULL,
  shop text NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Where to send the merchant afterwards. Validated as a same-origin path
  -- before it is written; never used raw.
  return_to text,
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Single use is enforced here, not in application code. Two callbacks racing
-- the same nonce must not both succeed.
CREATE UNIQUE INDEX oauth_states_state_key ON oauth_states (state);
CREATE INDEX oauth_states_sweep_idx ON oauth_states (expires_at) WHERE consumed_at IS NULL;

-- ── Store Health Scan ───────────────────────────────────────────────

CREATE TYPE scan_status AS ENUM ('queued', 'running', 'complete', 'failed');

CREATE TABLE scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The scan is a public, no-account lead magnet, so both are nullable. A
  -- signed-in merchant scanning their own store gets it attributed; an
  -- anonymous visitor does not.
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  store_id uuid REFERENCES stores(id) ON DELETE SET NULL,

  -- The normalised origin we actually fetched, not the raw string submitted.
  target_url text NOT NULL,
  status scan_status NOT NULL DEFAULT 'queued',

  -- Scores are 0-100 and only present once the audit lands.
  performance_score smallint,
  accessibility_score smallint,
  seo_score smallint,
  best_practices_score smallint,

  -- Raw metrics and the ranked findings, kept as jsonb so the report can gain
  -- checks without a migration per check.
  metrics jsonb,
  findings jsonb,

  -- Captured only when the visitor asks for the report by email.
  lead_email text,

  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT scans_score_range_ck CHECK (
    (performance_score IS NULL OR performance_score BETWEEN 0 AND 100) AND
    (accessibility_score IS NULL OR accessibility_score BETWEEN 0 AND 100) AND
    (seo_score IS NULL OR seo_score BETWEEN 0 AND 100) AND
    (best_practices_score IS NULL OR best_practices_score BETWEEN 0 AND 100)
  ),
  -- A finished scan owes the caller either results or a reason.
  CONSTRAINT scans_terminal_ck CHECK (
    status <> 'failed' OR error_message IS NOT NULL
  )
);

CREATE INDEX scans_recent_idx ON scans (created_at DESC);
CREATE INDEX scans_org_idx ON scans (organization_id, created_at DESC)
  WHERE organization_id IS NOT NULL;
-- Powers the abuse check: how many scans has this origin had lately.
CREATE INDEX scans_target_idx ON scans (target_url, created_at DESC);

-- ── Durable jobs ────────────────────────────────────────────────────
--
-- §1 of the addendum: a scan takes ~30s and a synchronous Netlify function
-- times out at ~10s, so the work has to be handed off. This table is what makes
-- the handoff durable — attempt count and last error live in Postgres rather
-- than in a queue service, which is the whole reason the addendum chose
-- Background Functions over a fourth SaaS bill.
--
-- Claimed by lease, exactly as notifications are, and for the same reason: the
-- HTTP driver has no transactions, so a row lock dies with the claim statement
-- and cannot protect work that outlives it.
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,

  run_after timestamptz NOT NULL DEFAULT now(),
  claimed_until timestamptz,
  attempts smallint NOT NULL DEFAULT 0,
  max_attempts smallint NOT NULL DEFAULT 3,

  completed_at timestamptz,
  failed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT jobs_attempts_ck CHECK (attempts >= 0 AND max_attempts >= 1)
);

CREATE INDEX jobs_ready_idx ON jobs (run_after, created_at)
  WHERE completed_at IS NULL AND failed_at IS NULL;
CREATE INDEX jobs_kind_idx ON jobs (kind, created_at DESC);
