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
