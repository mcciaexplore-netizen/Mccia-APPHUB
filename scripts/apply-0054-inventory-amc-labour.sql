-- Applies migration 0054 (Inventory AMC: the "Labour" contract type) to the live database, by hand. Paste the whole file into the SQL Editor of
-- the database production uses (DB_DRIVER "pg" in Vercel = Supabase, otherwise Neon; the database DATABASE_URL points to) and run it BEFORE
-- the code on feat/inventory-amc-branches is deployed. (scripts/apply-0053-inventory-amc.sql must have run first.)
--
-- Safe to run more than once, and it changes no existing row:
--   - the contract type list (inventory_amc_type) gains one value, "labour". No existing contract has it, and the code running in
--     production today never writes it, so it keeps working, and so does Instant Rollback.
--   - the value is added first, on its own (Postgres adds enum values outside a transaction's reach); then the migration is recorded.
--
-- To undo it: Postgres cannot drop a value from a type without rebuilding it; the unused value is harmless. Only the record can go:
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '1fdefb27efe0aee2b053695c88ca8560a6557d43991bdbd89e10098b2f1b0960';

ALTER TYPE "public"."inventory_amc_type" ADD VALUE IF NOT EXISTS 'labour';

BEGIN;

-- Records the migration as applied, so drizzle-kit migrate never runs it again.
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '1fdefb27efe0aee2b053695c88ca8560a6557d43991bdbd89e10098b2f1b0960', 1795670610430
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '1fdefb27efe0aee2b053695c88ca8560a6557d43991bdbd89e10098b2f1b0960');

COMMIT;

-- Afterwards this should return 1 and 1:
-- SELECT (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'inventory_amc_type' AND e.enumlabel = 'labour') AS labour_value,
--        (SELECT count(*) FROM drizzle.__drizzle_migrations WHERE hash = '1fdefb27efe0aee2b053695c88ca8560a6557d43991bdbd89e10098b2f1b0960') AS recorded;
