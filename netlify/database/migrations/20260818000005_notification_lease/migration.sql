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
