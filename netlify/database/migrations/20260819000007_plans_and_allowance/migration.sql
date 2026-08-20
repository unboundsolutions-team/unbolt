-- ══ Re-runnable ═══════════════════════════════════════════════════
-- Everything below is wrapped in a block that returns early if this
-- migration has already been applied, detected by the leads updated_at trigger.
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
IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'leads_set_updated_at') THEN
  RAISE NOTICE '20260819000007_plans_and_allowance is already applied — skipping.';
  RETURN;
END IF;

-- M6 — plans as data, task packs, and the allowance ledger.
--
-- ── What changed about the business model ───────────────────────────
-- The original brief sold an UNLIMITED queue gated by concurrency. The model is
-- now a finite, one-off pack: buy N tasks, use N tasks, buy again or upgrade.
-- Concurrency survives as a second, independent limit — a customer holding 5
-- credits may still only have 2 worked on at once.
--
-- Two limits, two different jobs:
--   allowance    — how much work they have PAID for      (this migration)
--   concurrency  — how much we deliver AT ONCE           (M4, tasks.slot)
--
-- Everything a plan defines is a column here rather than a constant in code,
-- because plans are administered, not deployed.

-- ── Plans ───────────────────────────────────────────────────────────

CREATE TABLE plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable machine name. Referenced by seeds and the marketing page; the
  -- display name can be edited freely without breaking either.
  code text NOT NULL,
  name text NOT NULL,
  description text,

  price_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',

  -- The pack. How many tasks one purchase grants.
  task_allowance integer NOT NULL,
  -- How many of those may be in flight simultaneously.
  concurrency_limit smallint NOT NULL DEFAULT 1,
  -- The estimation ceiling. A task estimated above this cannot proceed on this
  -- plan; the customer is asked to upgrade. NULL means no ceiling.
  max_task_hours numeric(6, 2),
  -- Response SLA in BUSINESS hours.
  sla_hours smallint NOT NULL DEFAULT 48,

  -- Hidden from the public pricing page. Enterprise and bespoke deals.
  is_public boolean NOT NULL DEFAULT true,
  is_custom boolean NOT NULL DEFAULT false,
  -- Retired plans stay for the purchases that reference them.
  is_active boolean NOT NULL DEFAULT true,
  sort_order smallint NOT NULL DEFAULT 0,

  stripe_price_id text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT plans_allowance_ck CHECK (task_allowance > 0),
  CONSTRAINT plans_concurrency_ck CHECK (concurrency_limit >= 1),
  CONSTRAINT plans_hours_ck CHECK (max_task_hours IS NULL OR max_task_hours > 0)
);

CREATE UNIQUE INDEX plans_code_key ON plans (code);
CREATE INDEX plans_public_idx ON plans (sort_order) WHERE is_public AND is_active;

CREATE TRIGGER plans_set_updated_at
  BEFORE UPDATE ON plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Per-customer overrides ──────────────────────────────────────────
--
-- The organisation already carries concurrency_limit and sla_hours from M4.
-- They now mean "the effective value", resolved from the plan at purchase time
-- and then editable per customer — the answer to "a negotiated deal should not
-- require inventing a plan tier".
--
-- max_task_hours joins them for the same reason.
ALTER TABLE organizations
  ADD COLUMN max_task_hours numeric(6, 2),
  -- Which plan they are currently on. Denormalised from the latest purchase so
  -- a page can name it without walking the purchase history.
  ADD COLUMN current_plan_id uuid REFERENCES plans(id) ON DELETE SET NULL,
  -- THE BALANCE. Authoritative, and the thing task creation decrements.
  --
  -- A counter rather than a SUM over the ledger, because a balance check has to
  -- be race-safe without transactions: `UPDATE … WHERE credits_remaining > 0`
  -- re-evaluates its WHERE clause against the freshly-locked row, so two
  -- simultaneous submissions cannot both spend the last credit. A SUM would be
  -- read-then-write, which M4 proved does not hold under contention.
  --
  -- The ledger below is the audit trail, and a test asserts the two never drift.
  ADD COLUMN credits_remaining integer NOT NULL DEFAULT 0,
  ADD COLUMN credits_granted_total integer NOT NULL DEFAULT 0,
  ADD COLUMN credits_used_total integer NOT NULL DEFAULT 0;

ALTER TABLE organizations ADD CONSTRAINT organizations_credits_ck CHECK (
  credits_remaining >= 0
  AND credits_granted_total >= 0
  AND credits_used_total >= 0
);

ALTER TABLE organizations ADD CONSTRAINT organizations_hours_ck CHECK (
  max_task_hours IS NULL OR max_task_hours > 0
);

-- ── Purchases ───────────────────────────────────────────────────────
--
-- One row per pack bought. Sales-led today: a payment link is sent by hand and
-- an admin records the result. The Stripe columns exist so self-serve can be
-- switched on later without a migration.

CREATE TYPE purchase_status AS ENUM ('pending', 'paid', 'refunded', 'void');
CREATE TYPE payment_method AS ENUM ('stripe', 'invoice', 'manual', 'comped');

CREATE TABLE plan_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,

  status purchase_status NOT NULL DEFAULT 'pending',
  method payment_method NOT NULL DEFAULT 'manual',

  -- Snapshot of what was bought, at the price and terms agreed. A later edit to
  -- the plan must not rewrite history — this is what an invoice is checked
  -- against, and what a dispute is settled with.
  tasks_granted integer NOT NULL,
  price_cents_paid integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  concurrency_at_purchase smallint,
  max_task_hours_at_purchase numeric(6, 2),
  sla_hours_at_purchase smallint,

  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  invoice_number text,
  po_number text,

  -- Who recorded it, and the note they left. Money moving on someone's say-so
  -- needs a name attached.
  recorded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  note text,

  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT plan_purchases_granted_ck CHECK (tasks_granted > 0),
  -- A paid purchase must say when. Reporting on revenue with a null date is
  -- how a month silently comes up short.
  CONSTRAINT plan_purchases_paid_ck CHECK (status <> 'paid' OR paid_at IS NOT NULL)
);

CREATE INDEX plan_purchases_org_idx ON plan_purchases (organization_id, created_at DESC);
-- Stripe delivers webhooks at least once, and a duplicate must not grant a
-- second pack. Uniqueness is what makes that impossible rather than unlikely.
CREATE UNIQUE INDEX plan_purchases_stripe_session_key
  ON plan_purchases (stripe_checkout_session_id)
  WHERE stripe_checkout_session_id IS NOT NULL;

CREATE TRIGGER plan_purchases_set_updated_at
  BEFORE UPDATE ON plan_purchases FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── The ledger ──────────────────────────────────────────────────────
--
-- Append-only. Every movement of a credit, with what caused it.
--
-- The counter on organizations is what enforces the limit; this is what
-- explains it. A customer asking "where did my five tasks go" gets an answer,
-- and an admin who grants a goodwill credit leaves a trace.

CREATE TYPE credit_event AS ENUM ('grant', 'consume', 'refund', 'adjust', 'expire');

CREATE TABLE credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type credit_event NOT NULL,
  -- Positive adds, negative spends. Never zero — a no-op entry is noise.
  delta integer NOT NULL,
  -- Balance immediately after this entry, as the counter saw it. Lets a drift
  -- between ledger and counter be located rather than just detected.
  balance_after integer NOT NULL,

  purchase_id uuid REFERENCES plan_purchases(id) ON DELETE SET NULL,
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT credit_ledger_delta_ck CHECK (delta <> 0)
);

CREATE INDEX credit_ledger_org_idx ON credit_ledger (organization_id, created_at DESC);

-- Append-only at the database level, exactly as task_events is. A billing
-- history that can be edited is not a billing history.
CREATE RULE credit_ledger_no_update AS ON UPDATE TO credit_ledger DO INSTEAD NOTHING;
CREATE RULE credit_ledger_no_delete AS ON DELETE TO credit_ledger DO INSTEAD NOTHING;

-- ── Task estimation ─────────────────────────────────────────────────

ALTER TABLE tasks
  -- Entered by the team on review, in hours.
  ADD COLUMN estimated_hours numeric(6, 2),
  ADD COLUMN estimated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN estimated_at timestamptz,
  -- Set when the estimate exceeds the customer's ceiling. The task stops here
  -- until they upgrade; it is not cancelled, because the work is still wanted.
  ADD COLUMN blocked_reason text,
  ADD COLUMN blocked_at timestamptz,
  -- Which purchase paid for this task. Makes "what did I get for that payment"
  -- answerable, and makes a refund able to find its tasks.
  ADD COLUMN purchase_id uuid REFERENCES plan_purchases(id) ON DELETE SET NULL;

ALTER TABLE tasks ADD CONSTRAINT tasks_estimate_ck CHECK (
  estimated_hours IS NULL OR estimated_hours >= 0
);

CREATE INDEX tasks_blocked_idx ON tasks (organization_id) WHERE blocked_at IS NOT NULL;
CREATE INDEX tasks_unestimated_idx ON tasks (created_at)
  WHERE estimated_hours IS NULL AND state = 'queued';

-- ── Comments ────────────────────────────────────────────────────────
--
-- The clarification loop. Without it every question about a task happens in
-- email and the timeline lies by omission.

CREATE TABLE task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  body text NOT NULL,
  -- Internal notes the customer never sees. Having one place for both means the
  -- team stops keeping a second, invisible thread elsewhere.
  is_internal boolean NOT NULL DEFAULT false,
  edited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT task_comments_body_ck CHECK (length(btrim(body)) > 0)
);

CREATE INDEX task_comments_task_idx ON task_comments (task_id, created_at);
-- The customer-visible thread, which is the common read.
CREATE INDEX task_comments_public_idx ON task_comments (task_id, created_at)
  WHERE NOT is_internal;

-- ── Leads ───────────────────────────────────────────────────────────
--
-- Path B is now the only path: plan interest becomes a conversation, not a
-- checkout. So the lead is the top of the funnel and needs to be a first-class
-- record rather than an email to a shared inbox.

CREATE TYPE lead_stage AS ENUM ('new', 'contacted', 'demo_booked', 'won', 'lost');

CREATE TABLE leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  company text,
  phone text,
  store_url text,
  -- Which plan they clicked. Not a commitment, but it is the single most useful
  -- thing to know before the call.
  interested_plan_id uuid REFERENCES plans(id) ON DELETE SET NULL,
  wants_demo boolean NOT NULL DEFAULT false,
  message text,
  -- GMV band, platform, urgency, team size — shape varies, so jsonb.
  qualification jsonb NOT NULL DEFAULT '{}'::jsonb,

  stage lead_stage NOT NULL DEFAULT 'new',
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  next_action_at timestamptz,
  -- Set once the lead becomes a customer, so the funnel can be measured.
  converted_organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX leads_stage_idx ON leads (stage, created_at DESC);
CREATE INDEX leads_followup_idx ON leads (next_action_at) WHERE stage NOT IN ('won', 'lost');

CREATE TRIGGER leads_set_updated_at
  BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Seed the plans that are already advertised ──────────────────────
--
-- Prices match src/content/site.ts. Task counts are placeholders chosen to be
-- obviously provisional rather than quietly wrong — they are administered from
-- /admin/plans and are expected to be set there before launch.
INSERT INTO plans (code, name, description, price_cents, task_allowance,
                   concurrency_limit, max_task_hours, sla_hours, is_public, sort_order)
VALUES
  ('standard', 'Standard',
   'For a single store with a steady trickle of work.',
   49900, 5, 1, 8, 48, true, 10),
  ('professional', 'Professional',
   'Two tasks moving at once, and a faster first response.',
   79900, 10, 2, 16, 24, true, 20),
  ('enterprise', 'Enterprise',
   'Multi-store, larger pieces of work, a named lead.',
   149900, 20, 4, 40, 8, false, 30);

END
$unbolt_migration$;
