-- ══ Re-runnable ═══════════════════════════════════════════════════
-- Everything below is wrapped in a block that returns early if this
-- migration has already been applied, detected by the enterprise plan being public.
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
IF EXISTS (SELECT 1 FROM plans WHERE code = 'enterprise' AND is_public) THEN
  RAISE NOTICE '20260820000011_publish_enterprise_plan is already applied — skipping.';
  RETURN;
END IF;

-- Show Enterprise on the pricing page.
--
-- It was seeded with is_public = false, on the reasoning that an invoiced tier
-- is a conversation rather than a purchase. That reasoning was wrong for the
-- page: a three-tier table where the third tier says "talk to us" is how buyers
-- expect to read pricing, and hiding it made the site look like a two-plan
-- product while the comparison table, the FAQ copy and the admin panel all
-- described three.
--
-- Done as a migration rather than a click in /admin/plans so every environment
-- agrees — a value only ever set by hand in production is one a preview deploy
-- or a fresh database silently disagrees with.
--
-- Idempotent: re-running sets it to the value it already has.
UPDATE plans SET is_public = true WHERE code = 'enterprise';

END
$unbolt_migration$;
