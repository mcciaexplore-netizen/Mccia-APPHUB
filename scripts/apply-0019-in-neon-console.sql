-- Applies migration 0019 (single sign-on: three columns on apps, a role per person per application) to the live database, by hand.
-- Paste the whole file into the Neon SQL Editor (project APPHUB) and run it BEFORE the new code is deployed.
--
-- Additive only, and safe to run more than once:
--   - apps gets sso_enabled (boolean, default false, not null) and sso_slug and sso_callback_url (both nullable), each added only if
--     missing (IF NOT EXISTS). A constant default is instant on Postgres 11+ (no table rewrite); every existing application stays
--     "single sign-on off", which is exactly how it behaves today.
--   - user_app_access gets app_role (text, default 'user', not null) with a check that it is 'user' or 'admin'. Every existing grant
--     becomes 'user'. The constraint is added only if it is not there yet, and the column is added before it so the check can pass.
--   - a unique index on apps.sso_slug where it is not null (so many applications can have no slug, but no two share one).
--   - the code running in production today never mentions these columns: it inserts apps and grants with explicit column lists and
--     reads by name, so it keeps working unchanged after this runs. The new code needs them, which is why this goes first.
--   - the migration log entry is added only if it is not there yet.

BEGIN;

ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "sso_enabled" boolean DEFAULT false NOT NULL;
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "sso_slug" text;
ALTER TABLE "apps" ADD COLUMN IF NOT EXISTS "sso_callback_url" text;
ALTER TABLE "user_app_access" ADD COLUMN IF NOT EXISTS "app_role" text DEFAULT 'user' NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "apps_sso_slug_uq" ON "apps" USING btree ("sso_slug") WHERE "apps"."sso_slug" is not null;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_app_access_app_role_check' AND conrelid = 'public.user_app_access'::regclass
  ) THEN
    ALTER TABLE "user_app_access" ADD CONSTRAINT "user_app_access_app_role_check" CHECK ("user_app_access"."app_role" in ('user', 'admin'));
  END IF;
END
$$;

-- Migration log entry (hash of drizzle/0019_sso.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '2e66961a9b742fd3f23aacedfd74bfe89fdeec9b416e70a964e739774bc51ce1', 1793100760998
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '2e66961a9b742fd3f23aacedfd74bfe89fdeec9b416e70a964e739774bc51ce1');

COMMIT;

-- Afterwards this should show sso_enabled, sso_slug and sso_callback_url at the end of apps, and app_role at the end of user_app_access:
-- SELECT table_name, column_name, data_type, column_default, is_nullable FROM information_schema.columns
--   WHERE (table_name = 'apps' AND column_name LIKE 'sso_%') OR (table_name = 'user_app_access' AND column_name = 'app_role') ORDER BY table_name, ordinal_position;
