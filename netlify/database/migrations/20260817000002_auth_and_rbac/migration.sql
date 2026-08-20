-- ══ Re-runnable ═══════════════════════════════════════════════════
-- Everything below is wrapped in a block that returns early if this
-- migration has already been applied, detected by the last-owner guard trigger.
--
-- Why: TWO systems apply these files. Netlify applies them itself before
-- publishing a deploy, keeping its own record of what it has run, and
-- `npm run db:migrate` applies them from a laptop, keeping ours in
-- schema_migrations. The two records are invisible to each other.
--
-- Applying this schema to the production database by hand and then
-- deploying was enough to wedge it permanently: Netlify's record was
-- empty, so it started again from the first migration and hit
--
--     pq: type "org_role" already exists
--
-- which blocks the publish. Every deploy after that failed the same way,
-- and no amount of retrying could clear it, because the database and the
-- record it was checked against could not be reconciled from either side.
--
-- The guard makes "already applied" a fact about the database rather than
-- about whichever ledger is asking, so either system can run these in any
-- order, any number of times.
--
-- It does NOT make the file safe to edit — an applied migration is still
-- immutable, and both runners still refuse a changed one. Nor does it make
-- the statements inside individually idempotent: a backfill still runs
-- exactly once, because the whole file is skipped rather than each
-- statement being made harmless. That is deliberate. Statement-level
-- idempotency would let an UPDATE that backfills a column run a second
-- time over data it has no business touching.
-- ══════════════════════════════════════════════════════════════════
DO $unbolt_migration$
BEGIN
IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'memberships_last_owner_guard') THEN
  RAISE NOTICE '20260817000002_auth_and_rbac is already applied — skipping.';
  RETURN;
END IF;

-- Unbolt M3 — authentication, org context and RBAC
--
-- Applied automatically by Netlify before a deploy is published.
--
-- ── The decision this migration encodes ─────────────────────────────
-- Better Auth ships an `organization` plugin with its own org / member /
-- invitation tables. We do NOT use it. M0's tenancy schema is richer in ways
-- that matter commercially and legally: billing_type and org_status drive
-- Stripe and dunning, internal_role gates /admin, and audit_logs is append-only
-- at the database level. Adopting the plugin would mean either duplicating
-- those tables or losing that.
--
-- So the split is:
--   Better Auth  →  authentication only (credentials, sessions, verification)
--   Our schema   →  tenancy, roles, authorization, audit
--
-- Better Auth reads and writes `users`, `sessions`, `accounts` and
-- `verifications` through explicit field mapping in src/lib/auth.ts. Everything
-- about *what a user may do* stays in our service layer, where it is testable
-- without standing up an auth server.

-- ── users: the fields Better Auth requires ──────────────────────────
-- M0 modelled verification as a nullable timestamp, which is strictly more
-- information. Better Auth needs a boolean, so we keep both and derive.
ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE users SET email_verified = (email_verified_at IS NOT NULL);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── sessions: Better Auth owns the session lifecycle ────────────────
-- M0 stored only a SHA-256 of the session token. Better Auth issues, rotates
-- and revokes sessions itself and looks them up by the token it holds, so the
-- column becomes the token. token_hash is retained but relaxed to nullable so
-- the M0 rows (there are none in production yet) do not block the migration,
-- and so the column can be dropped in a later, separate migration once we are
-- certain nothing reads it.
ALTER TABLE sessions ADD COLUMN token TEXT;
ALTER TABLE sessions ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE sessions ALTER COLUMN token_hash DROP NOT NULL;

CREATE UNIQUE INDEX sessions_token_value_key ON sessions (token);

CREATE TRIGGER sessions_set_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── accounts: credentials and OAuth links ───────────────────────────
-- Better Auth stores the password hash HERE, not on users. That is a better
-- shape than M0's users.password_hash: it lets one human hold a password and
-- a Google link and a GitHub link without the user row growing a column per
-- provider. users.password_hash is left in place for this migration and
-- removed once Better Auth is confirmed in production.
CREATE TABLE accounts (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  account_id               TEXT NOT NULL,
  provider_id              TEXT NOT NULL,
  -- Argon2id, managed by Better Auth. Null for OAuth-only accounts.
  password                 TEXT,
  access_token             TEXT,
  refresh_token            TEXT,
  id_token                 TEXT,
  access_token_expires_at  TIMESTAMPTZ,
  refresh_token_expires_at TIMESTAMPTZ,
  scope                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- One link per provider per user; the pair is what Better Auth looks up.
CREATE UNIQUE INDEX accounts_provider_account_key ON accounts (provider_id, account_id);
CREATE INDEX accounts_user_idx ON accounts (user_id);

CREATE TRIGGER accounts_set_updated_at
  BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── verifications: email verification and password reset ────────────
CREATE TABLE verifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier TEXT NOT NULL,
  value      TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX verifications_identifier_idx ON verifications (identifier);
-- Expired rows are swept by a Scheduled Function (M4); the index keeps that cheap.
CREATE INDEX verifications_expiry_idx ON verifications (expires_at);

CREATE TRIGGER verifications_set_updated_at
  BEFORE UPDATE ON verifications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Owner protection, enforced by the database ──────────────────────
-- "Every organization keeps at least one owner" was a service-layer rule in M0
-- with only an index to support it. A service-layer rule is one forgotten code
-- path away from an org nobody can administer, which is unrecoverable without
-- staff intervention. This makes the database refuse it.
CREATE OR REPLACE FUNCTION memberships_guard_last_owner() RETURNS TRIGGER AS $$
DECLARE
  remaining INTEGER;
BEGIN
  -- Only relevant when an owner is being removed or demoted.
  IF (TG_OP = 'DELETE' AND OLD.role <> 'owner') THEN RETURN OLD; END IF;
  IF (TG_OP = 'UPDATE' AND (OLD.role <> 'owner' OR NEW.role = 'owner')) THEN RETURN NEW; END IF;

  SELECT COUNT(*) INTO remaining
  FROM memberships
  WHERE organization_id = OLD.organization_id
    AND role = 'owner'
    AND id <> OLD.id;

  IF remaining = 0 THEN
    RAISE EXCEPTION 'organization % must retain at least one owner', OLD.organization_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF (TG_OP = 'DELETE') THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER memberships_last_owner_guard
  BEFORE UPDATE OR DELETE ON memberships
  FOR EACH ROW EXECUTE FUNCTION memberships_guard_last_owner();

END
$unbolt_migration$;
