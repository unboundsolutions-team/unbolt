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
