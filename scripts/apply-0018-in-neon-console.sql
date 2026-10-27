-- Applies migration 0018 (sign-in attempts: which form they came from, and whether the limits refused them) to the live database, by
-- hand. Paste the whole file into the Neon SQL Editor (project APPHUB) and run it BEFORE the new code is deployed.
--
-- Additive only, and safe to run more than once:
--   - two new columns, each with a default, added only if missing (IF NOT EXISTS). On Postgres 11+ a constant default is instant (no
--     table rewrite).
--   - the code running in production today never writes login_attempts and reads only its existing columns by name, so it keeps
--     working unchanged after this runs. The new code needs these columns, which is why this goes first.
--   - the migration log entry is added only if it is not there yet.

BEGIN;

ALTER TABLE "login_attempts" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'login' NOT NULL;
ALTER TABLE "login_attempts" ADD COLUMN IF NOT EXISTS "blocked" boolean DEFAULT false NOT NULL;

-- Migration log entry (hash of drizzle/0018_login_attempt_kind.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '1acd60cb7878b43707834e451a799987d7cdc6e36ac7076467584ac2011bb006', 1792171331153
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '1acd60cb7878b43707834e451a799987d7cdc6e36ac7076467584ac2011bb006');

COMMIT;

-- Afterwards this should show the two new columns (kind, blocked) at the end:
-- SELECT column_name, data_type, column_default, is_nullable FROM information_schema.columns WHERE table_name = 'login_attempts' ORDER BY ordinal_position;
