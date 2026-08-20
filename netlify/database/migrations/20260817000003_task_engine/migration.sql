-- ══ Re-runnable ═══════════════════════════════════════════════════
-- Everything below is wrapped in a block that returns early if this
-- migration has already been applied, detected by notifications_user_idx.
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
IF to_regclass('public.notifications_user_idx') IS NOT NULL THEN
  RAISE NOTICE '20260817000003_task_engine is already applied — skipping.';
  RETURN;
END IF;

-- Unbolt M4 — the task engine
--
-- The queue is the product, so this migration carries the two numbers the whole
-- commercial promise rests on: `position` (unlimited queue) and the state that
-- decides whether a task occupies one of the plan's concurrency slots.

-- ── Plan shape moves onto the organisation ──────────────────────────
-- Concurrency and SLA were implicit in the pricing table on the marketing site.
-- They have to be real columns before the engine can enforce them, and they
-- live on the org rather than on a plans table because an Enterprise customer
-- can be sold a bespoke cap without inventing a new plan row.
ALTER TABLE organizations ADD COLUMN concurrency_limit SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE organizations ADD COLUMN sla_hours SMALLINT NOT NULL DEFAULT 48;
ALTER TABLE organizations
  ADD CONSTRAINT organizations_concurrency_ck CHECK (concurrency_limit BETWEEN 1 AND 50);

CREATE TYPE task_state AS ENUM ('queued', 'in_progress', 'in_review', 'shipped', 'cancelled');

CREATE TABLE stores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  domain          TEXT NOT NULL,
  platform        TEXT NOT NULL DEFAULT 'shopify',
  access_token    TEXT,
  connected_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX stores_org_domain_key ON stores (organization_id, LOWER(domain));

CREATE TRIGGER stores_set_updated_at
  BEFORE UPDATE ON stores FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE tasks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  store_id          UUID REFERENCES stores (id) ON DELETE SET NULL,

  -- Human-facing reference, e.g. UNB-312. Unique per organisation so two
  -- customers can both have a UNB-001 without a global counter leaking how
  -- many tasks the whole business has ever run.
  reference         TEXT NOT NULL,

  -- Written from the buyer's side: a symptom the merchant would recognise,
  -- never "Bug fix #1". A social rule, stated here so it survives.
  title             TEXT NOT NULL,
  body              TEXT,

  state             task_state NOT NULL DEFAULT 'queued',

  -- Position within the organisation's queue. NULL once the task has left the
  -- queue — keeping a stale number would make "you are 3rd" wrong for everyone
  -- behind it.
  position          INTEGER,

  created_by        UUID REFERENCES users (id) ON DELETE SET NULL,
  assigned_to       UUID REFERENCES users (id) ON DELETE SET NULL,

  queued_at         TIMESTAMPTZ,
  -- Response deadline, computed in BUSINESS hours at queue time.
  sla_deadline      TIMESTAMPTZ,
  -- Set the moment we first respond. The SLA is met or missed here — the site
  -- promises a response time, never a delivery time.
  first_response_at TIMESTAMPTZ,
  started_at        TIMESTAMPTZ,
  shipped_at        TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,

  preview_url       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A task in the queue must have a position; one that has left must not.
  CONSTRAINT tasks_position_ck CHECK (
    (state = 'queued' AND position IS NOT NULL) OR
    (state <> 'queued' AND position IS NULL)
  )
);

CREATE UNIQUE INDEX tasks_org_reference_key ON tasks (organization_id, reference);
CREATE INDEX tasks_org_state_idx ON tasks (organization_id, state);
-- Only one task may hold a given queue position within an organisation.
CREATE UNIQUE INDEX tasks_org_position_key ON tasks (organization_id, position)
  WHERE state = 'queued';

-- Counting in-flight work is the hottest query in the product: it runs on every
-- state change to enforce concurrency. A partial index keeps it to the handful
-- of rows that actually occupy a slot.
CREATE INDEX tasks_in_flight_idx ON tasks (organization_id)
  WHERE state IN ('in_progress', 'in_review');

-- Finding what is about to breach, across all organisations, for the admin queue.
CREATE INDEX tasks_sla_watch_idx ON tasks (sla_deadline)
  WHERE first_response_at IS NULL AND state NOT IN ('shipped', 'cancelled');

CREATE TRIGGER tasks_set_updated_at
  BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE task_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    UUID NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  actor_id   UUID REFERENCES users (id) ON DELETE SET NULL,
  type       TEXT NOT NULL,
  from_state task_state,
  to_state   task_state,
  body       TEXT,
  -- Internal triage notes. Never serialised to a customer.
  internal   BOOLEAN NOT NULL DEFAULT FALSE,
  metadata   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX task_events_task_created_idx ON task_events (task_id, created_at);

-- The task timeline is the transparency pillar made literal. If it can be
-- edited after the fact it proves nothing, so it is append-only at the database
-- level, exactly like audit_logs.
CREATE RULE task_events_no_update AS ON UPDATE TO task_events DO INSTEAD NOTHING;
CREATE RULE task_events_no_delete AS ON DELETE TO task_events DO INSTEAD NOTHING;

-- ── Notifications ───────────────────────────────────────────────────
-- A durable outbox rather than sending inline. Email providers fail, and a
-- failed send must never roll back the state change that caused it — the task
-- did ship, whether or not the notification went out.
CREATE TABLE notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  task_id      UUID REFERENCES tasks (id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  payload      JSONB NOT NULL,
  -- Null until delivered. Retried by a Scheduled Function.
  sent_at      TIMESTAMPTZ,
  failed_at    TIMESTAMPTZ,
  attempts     SMALLINT NOT NULL DEFAULT 0,
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX notifications_pending_idx ON notifications (created_at)
  WHERE sent_at IS NULL AND failed_at IS NULL;
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

END
$unbolt_migration$;
