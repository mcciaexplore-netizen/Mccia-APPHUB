-- Applies migration 0051 (DesignDesk: each design on a request is its own deliverable) to the live database, by hand. Paste the whole file
-- into the SQL Editor of the database production uses (DB_DRIVER "pg" in Vercel = Supabase, otherwise Neon; the database DATABASE_URL points
-- to) and run it BEFORE the code on feat/design-multi-deliverables is deployed.
--
-- Safe to run more than once, and it changes no existing row's meaning:
--   - design_tickets gains per_item (boolean, false for every existing ticket). Existing tickets keep the older flow: one approved proof
--     delivers the ticket and the edit window closes it. Only requests made after the deploy are per-item.
--   - design_proof_versions gains item_key (text, empty on every existing proof): which design on the ticket a proof is for.
--   The code running in production today never reads either column, so it keeps working, and so does Instant Rollback.
--
-- To undo it (only before any per-item ticket exists, or their per-design progress is lost):
--   ALTER TABLE design_proof_versions DROP COLUMN IF EXISTS item_key;
--   ALTER TABLE design_tickets DROP COLUMN IF EXISTS per_item;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = 'b56cedfc2e1cfdadd96440a54c369c5730d5f2e50f7f40fc98be4611ea25daf2';

BEGIN;

ALTER TABLE "design_proof_versions" ADD COLUMN IF NOT EXISTS "item_key" text;
ALTER TABLE "design_tickets" ADD COLUMN IF NOT EXISTS "per_item" boolean DEFAULT false NOT NULL;

-- Records the migration as applied, so drizzle-kit migrate never runs it again.
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT 'b56cedfc2e1cfdadd96440a54c369c5730d5f2e50f7f40fc98be4611ea25daf2', 1795599965967
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'b56cedfc2e1cfdadd96440a54c369c5730d5f2e50f7f40fc98be4611ea25daf2');

COMMIT;

-- Afterwards this should return 1, 1 and 1:
-- SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name = 'design_tickets' AND column_name = 'per_item') AS per_item,
--        (SELECT count(*) FROM information_schema.columns WHERE table_name = 'design_proof_versions' AND column_name = 'item_key') AS item_key,
--        (SELECT count(*) FROM drizzle.__drizzle_migrations WHERE hash = 'b56cedfc2e1cfdadd96440a54c369c5730d5f2e50f7f40fc98be4611ea25daf2') AS recorded;
