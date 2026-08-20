-- ══ Re-runnable ═══════════════════════════════════════════════════
-- Everything below is wrapped in a block that returns early if this
-- migration has already been applied, detected by notifications.claimed_until.
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
IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'claimed_until') THEN
  RAISE NOTICE '20260818000005_notification_lease is already applied — skipping.';
  RETURN;
END IF;

-- Give claimed notifications a visibility lease.
--
-- ── The bug this fixes ──────────────────────────────────────────────
-- The outbox worker claimed rows with SELECT … FOR UPDATE SKIP LOCKED, which is
-- the correct pattern when the claim, the send and the acknowledgement all sit
-- inside one transaction. They cannot here: the Neon HTTP driver has no
-- transactions, so each statement is its own, and the row lock is released the
-- instant the claim statement returns — long before the email is sent.
--
-- SKIP LOCKED therefore only protects workers whose statements overlap to the
-- millisecond. Two workers a heartbeat apart both claim the same row and the
-- customer is told twice that their task shipped. An integration test with two
-- concurrent claims caught exactly that.
--
-- ── The fix ─────────────────────────────────────────────────────────
-- The claim stops being a lock and becomes a lease with a deadline written to
-- the row. A claimed row is invisible to other workers until the lease expires,
-- which survives the statement ending, the connection closing and the worker
-- process dying — the last of which is the case a lock could never have
-- handled either, since a crashed worker's lock dies with it and the row would
-- have been retried immediately anyway.
--
-- Delivery stays at-least-once by design: a worker that sends and then dies
-- before acknowledging will have its lease expire and the message will go
-- again. A rare duplicate "your task shipped" is a far smaller harm than a
-- silent miss, and exactly-once across our database and a third-party mail API
-- is not purchasable at any price.

ALTER TABLE notifications ADD COLUMN claimed_until timestamptz;

-- The pending index has to know about the lease too, or every worker scans
-- every leased row on its way to finding work.
DROP INDEX IF EXISTS notifications_pending_idx;
CREATE INDEX notifications_pending_idx
  ON notifications (claimed_until NULLS FIRST, created_at)
  WHERE sent_at IS NULL AND failed_at IS NULL;

COMMENT ON COLUMN notifications.claimed_until IS
  'Lease deadline. A worker that claims this row hides it from other workers '
  'until this time; NULL means unclaimed. Expiry is what makes a crashed '
  'worker''s messages get retried instead of being lost.';

END
$unbolt_migration$;
