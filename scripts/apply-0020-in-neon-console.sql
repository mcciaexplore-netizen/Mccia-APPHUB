-- Applies migration 0020 (a third role, super_admin, for a person inside a single sign-on application) to the live database, by hand.
-- Paste the whole file into the Neon SQL Editor (project APPHUB, PRODUCTION branch) and run it BEFORE the new code is deployed.
--
-- Safe, and safe to run more than once:
--   - the check on user_app_access.app_role is replaced by one that also allows 'super_admin'. It only widens what is allowed: every
--     existing row ('user' or 'admin') still passes, and nothing is rewritten. The swap is in one transaction, so there is no moment
--     without the check.
--   - the code running in production today only ever writes 'user' or 'admin', and reads any other value as 'user', so it keeps working
--     unchanged after this runs.
--   - the migration log entry is added only if it is not there yet.

BEGIN;

ALTER TABLE "user_app_access" DROP CONSTRAINT IF EXISTS "user_app_access_app_role_check";
ALTER TABLE "user_app_access" ADD CONSTRAINT "user_app_access_app_role_check" CHECK ("user_app_access"."app_role" in ('user', 'admin', 'super_admin'));

-- Migration log entry (hash of drizzle/0020_app_super_admin_role.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '086e43af856338072d95c6763ce6b08853add68d0e69460193e0612ec7b2c406', 1793189112164
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '086e43af856338072d95c6763ce6b08853add68d0e69460193e0612ec7b2c406');

COMMIT;

-- Afterwards this should show the check with 'user', 'admin' and 'super_admin':
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'user_app_access_app_role_check';
