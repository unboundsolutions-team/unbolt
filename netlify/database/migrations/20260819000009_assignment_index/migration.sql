-- ══ Re-runnable ═══════════════════════════════════════════════════
-- Everything below is wrapped in a block that returns early if this
-- migration has already been applied, detected by tasks_unassigned_idx.
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
IF to_regclass('public.tasks_unassigned_idx') IS NOT NULL THEN
  RAISE NOTICE '20260819000009_assignment_index is already applied — skipping.';
  RETURN;
END IF;

-- Make "what am I working on" a fast question.
--
-- `tasks.assigned_to` has existed since M4, but nothing set it deliberately —
-- it was a side effect of the first transition into in_progress, and nothing
-- read it. Assignment is now explicit, which means two new queries run on every
-- admin page load: one engineer's open work, and the workload across the team.
--
-- Partial, on open work only. A shipped task's assignee matters for history but
-- never for "who is busy right now", and after a year the index would be mostly
-- finished work nobody queries by owner.
CREATE INDEX tasks_assignee_open_idx
  ON tasks (assigned_to)
  WHERE assigned_to IS NOT NULL AND state NOT IN ('shipped', 'cancelled');

-- The other half of the same question: what is waiting for an owner.
CREATE INDEX tasks_unassigned_idx
  ON tasks (created_at)
  WHERE assigned_to IS NULL AND state NOT IN ('shipped', 'cancelled');

COMMENT ON COLUMN tasks.assigned_to IS
  'The engineer who owns this task. Set explicitly from /admin, and also on the '
  'first transition into in_progress so picking work up still claims it.';

END
$unbolt_migration$;
