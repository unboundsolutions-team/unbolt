-- ══ Re-runnable ═══════════════════════════════════════════════════
-- Everything below is wrapped in a block that returns early if this
-- migration has already been applied, detected by the organizations updated_at trigger.
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
IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'organizations_set_updated_at') THEN
  RAISE NOTICE '20260816000001_identity_and_tenancy is already applied — skipping.';
  RETURN;
END IF;

-- Unbolt M0 — identity & tenancy
-- Applied automatically by Netlify before a deploy is published.
-- A failure here blocks the publish, so this file must be idempotent-safe
-- and reviewed as carefully as application code.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE org_role       AS ENUM ('owner', 'admin', 'member', 'viewer');
CREATE TYPE internal_role  AS ENUM ('engineer', 'pm', 'superadmin');
CREATE TYPE billing_type   AS ENUM ('stripe', 'invoice', 'trial', 'comped');
CREATE TYPE org_status     AS ENUM ('active', 'past_due', 'paused', 'cancelled');

CREATE TABLE organizations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  slug               TEXT NOT NULL,
  status             org_status NOT NULL DEFAULT 'active',
  billing_type       billing_type NOT NULL DEFAULT 'trial',
  stripe_customer_id TEXT,
  provisioned_by     UUID,
  trial_ends_at      TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX organizations_slug_key ON organizations (slug);
CREATE INDEX organizations_status_idx      ON organizations (status);

CREATE TABLE users (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                  TEXT NOT NULL,
  email_verified_at      TIMESTAMPTZ,
  password_hash          TEXT,
  name                   TEXT,
  avatar_url             TEXT,
  is_internal            BOOLEAN NOT NULL DEFAULT FALSE,
  internal_role          internal_role,
  two_factor_enabled_at  TIMESTAMPTZ,
  last_login_at          TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Internal staff must carry a role; clients must not.
  CONSTRAINT users_internal_role_ck
    CHECK ((is_internal = FALSE AND internal_role IS NULL)
        OR (is_internal = TRUE  AND internal_role IS NOT NULL))
);
CREATE UNIQUE INDEX users_email_key   ON users (LOWER(email));
CREATE INDEX users_internal_idx       ON users (is_internal) WHERE is_internal = TRUE;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_provisioned_by_fk
  FOREIGN KEY (provisioned_by) REFERENCES users (id) ON DELETE SET NULL;

CREATE TABLE memberships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role            org_role NOT NULL DEFAULT 'member',
  invited_by      UUID REFERENCES users (id) ON DELETE SET NULL,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX memberships_org_user_key ON memberships (organization_id, user_id);
CREATE INDEX memberships_user_idx            ON memberships (user_id);

-- Every organization must retain at least one owner. Enforced in the service
-- layer on role change and removal; this partial index makes the lookup free.
CREATE INDEX memberships_owner_idx ON memberships (organization_id) WHERE role = 'owner';

CREATE TABLE invitations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  role            org_role NOT NULL DEFAULT 'member',
  token_hash      TEXT NOT NULL,
  invited_by      UUID REFERENCES users (id) ON DELETE SET NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  accepted_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX invitations_token_key   ON invitations (token_hash);
CREATE INDEX invitations_org_email_idx      ON invitations (organization_id, email);

CREATE TABLE sessions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash             TEXT NOT NULL,
  active_organization_id UUID REFERENCES organizations (id) ON DELETE SET NULL,
  ip_address             TEXT,
  user_agent             TEXT,
  expires_at             TIMESTAMPTZ NOT NULL,
  revoked_at             TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX sessions_token_key ON sessions (token_hash);
CREATE INDEX sessions_user_idx         ON sessions (user_id);
CREATE INDEX sessions_expiry_idx       ON sessions (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations (id) ON DELETE SET NULL,
  actor_id        UUID REFERENCES users (id) ON DELETE SET NULL,
  action          TEXT NOT NULL,
  resource_type   TEXT,
  resource_id     TEXT,
  ip_address      TEXT,
  user_agent      TEXT,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX audit_logs_org_created_idx ON audit_logs (organization_id, created_at DESC);
CREATE INDEX audit_logs_actor_idx       ON audit_logs (actor_id);

-- Audit log is append-only. Revoke mutation at the database level so an
-- application bug cannot rewrite history.
CREATE RULE audit_logs_no_update AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
CREATE RULE audit_logs_no_delete AS ON DELETE TO audit_logs DO INSTEAD NOTHING;

-- Keep updated_at honest without application involvement.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER organizations_set_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

END
$unbolt_migration$;
