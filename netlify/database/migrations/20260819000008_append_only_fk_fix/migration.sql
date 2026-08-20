-- ══ Re-runnable ═══════════════════════════════════════════════════
-- Everything below is wrapped in a block that returns early if this
-- migration has already been applied, detected by the removal of credit_ledger_task_id_fkey.
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
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_ledger_task_id_fkey') THEN
  RAISE NOTICE '20260819000008_append_only_fk_fix is already applied — skipping.';
  RETURN;
END IF;

-- Make it possible to delete a user.
--
-- ── The bug ─────────────────────────────────────────────────────────
-- `audit_logs` and `task_events` are append-only: DO INSTEAD NOTHING rules
-- discard any UPDATE or DELETE against them, which is what makes an audit trail
-- an audit trail. They also carry `ON DELETE SET NULL` foreign keys to `users`
-- and `organizations`.
--
-- Those two facts cannot both hold. Deleting a user makes Postgres issue an
-- UPDATE against the referencing rows to null the column; the rule discards it;
-- Postgres then finds the referencing rows still present and aborts:
--
--   ERROR: referential integrity query on "users" from constraint
--          "audit_logs_actor_id_fkey" on "audit_logs" gave unexpected result
--   HINT:  This is most likely due to a rule having rewritten the query.
--
-- So **no user could ever be deleted**. Not an offboarded engineer, not a test
-- account, not a GDPR erasure request. It has been latent since M0 and was
-- found only by executing a DELETE — nothing about the schema reads as wrong.
--
-- ── The fix ─────────────────────────────────────────────────────────
-- On an append-only table the referencing columns become plain uuids with no
-- foreign key. That is the correct shape for a ledger or an audit log
-- regardless of this bug: such a record must survive the deletion of what it
-- describes. An audit entry that loses its actor when the actor is deleted has
-- destroyed the one fact it existed to preserve, and "who did this" is exactly
-- what you need after someone's access is revoked.
--
-- The trade is that these columns can now hold an id that no longer resolves.
-- That is intended: the reader joins with a LEFT JOIN and renders "a deleted
-- user", which is the honest answer.
--
-- FKs that CASCADE are kept. A cascade deletes the referencing row outright
-- rather than updating it, so the rules never see it and the contradiction
-- does not arise — deleting a task really should take its timeline with it.

ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_actor_id_fkey;
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_organization_id_fkey;

ALTER TABLE task_events DROP CONSTRAINT IF EXISTS task_events_actor_id_fkey;

ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_actor_id_fkey;
ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_purchase_id_fkey;
-- task_id additionally has to go because the credit for a task is spent BEFORE
-- the task row exists — the id is generated up front so the spend can name the
-- task it paid for, and a foreign key would reject that ordering. Claiming the
-- credit second would mean a task could exist without having been paid for.
ALTER TABLE credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_task_id_fkey;

COMMENT ON COLUMN audit_logs.actor_id IS
  'Historical reference. No FK: this table is append-only, so ON DELETE SET NULL '
  'would be discarded by the rules and make the referenced row undeletable.';
COMMENT ON COLUMN task_events.actor_id IS
  'Historical reference. No FK — see audit_logs.actor_id.';
COMMENT ON COLUMN credit_ledger.task_id IS
  'Historical reference. No FK: the credit is spent before the task row exists.';

END
$unbolt_migration$;
