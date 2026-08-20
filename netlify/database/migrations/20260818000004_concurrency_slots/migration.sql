-- Make the concurrency cap unbreakable.
--
-- ── The bug this fixes ──────────────────────────────────────────────
-- The task engine enforced the cap by counting in-flight tasks inside the same
-- statement that moved the task, serialised by SELECT … FOR UPDATE on the
-- organisation row. Integration tests against a real Postgres proved that does
-- not work: six simultaneous claims against a limit of 2 started FIVE tasks.
--
-- The reason is snapshot semantics. Every CTE in a single statement is
-- evaluated against one snapshot taken when the statement begins. FOR UPDATE
-- serialises the waiters, but when a waiter is finally granted the lock it does
-- NOT get a fresh snapshot for the rest of the query — so the count of running
-- work is still the value from before it waited. Each waiter reads "0 running"
-- and every one of them proceeds.
--
-- Counting can therefore never enforce this on a driver with no transactions.
--
-- ── The fix ─────────────────────────────────────────────────────────
-- Stop counting. Give each running task an explicit slot number in 1..limit and
-- make the database refuse a duplicate. The cap stops being a rule the
-- application remembers to check and becomes a property of the schema: there is
-- no interleaving, no snapshot and no lock ordering that can produce a third
-- occupant of a two-slot organisation, because the unique index would have to
-- accept the same (organization_id, slot) twice.
--
-- A concurrent loser now gets a unique violation instead of a silent overrun.
-- The engine catches it and retries against a fresh snapshot; the statement is
-- atomic, so a failed attempt leaves nothing behind.

ALTER TABLE tasks ADD COLUMN slot smallint;

-- The whole cap, in one line. A slot is held only while the task occupies one;
-- shipped and cancelled work releases it by setting slot back to NULL.
CREATE UNIQUE INDEX tasks_org_slot_key
  ON tasks (organization_id, slot)
  WHERE state IN ('in_progress', 'in_review');

-- Backfill any work already running, oldest first. This has to happen BEFORE
-- the CHECK below: on a database that already has tasks in flight, adding the
-- constraint first fails the migration and blocks the deploy.
WITH numbered AS (
  SELECT id, row_number() OVER (
    PARTITION BY organization_id ORDER BY started_at NULLS LAST, created_at
  ) AS rn
  FROM tasks
  WHERE state IN ('in_progress', 'in_review')
)
UPDATE tasks SET slot = numbered.rn
FROM numbered
WHERE tasks.id = numbered.id;

-- Slot and state must agree. Without this, a bug elsewhere could park a task
-- in_progress with no slot and quietly reopen the hole this migration closes.
ALTER TABLE tasks ADD CONSTRAINT tasks_slot_ck CHECK (
  (state IN ('in_progress', 'in_review') AND slot IS NOT NULL AND slot >= 1)
  OR (state NOT IN ('in_progress', 'in_review') AND slot IS NULL)
);

COMMENT ON COLUMN tasks.slot IS
  'Which concurrency slot this task occupies, 1..organizations.concurrency_limit. '
  'NULL unless the task is in_progress or in_review. Uniqueness of '
  '(organization_id, slot) is what enforces the plan cap — see tasks_org_slot_key.';
