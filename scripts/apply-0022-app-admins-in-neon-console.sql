-- Applies migration 0022 (app_admins: who is an admin of each application) to the live database, by hand.
-- Paste the whole file into the Neon SQL Editor (project APPHUB, PRODUCTION branch) and run it BEFORE the App Admins code is deployed:
-- the new code reads this table on the Applications page, in Inventory and when opening a single sign-on application.
--
-- Additive only, and safe to run more than once:
--   - it only CREATES the table app_admins (with its keys and one index). No existing table, column or row is changed or read.
--   - everything is created together in one transaction, and only if app_admins is not there yet.
--   - the code running in production today never mentions app_admins, so it keeps working unchanged after this runs.
--   - the migration log entry is added only if it is not there yet.
--
-- To undo it before anyone has been made an App Admin:
--   DROP TABLE app_admins;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '28cdd503d153431cca64eea8b5142c7b055346c2b8f6bb461c78416c73dcbeba';

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.app_admins') IS NULL THEN
    CREATE TABLE "app_admins" (
    	"app_id" uuid NOT NULL,
    	"user_id" uuid NOT NULL,
    	"added_by_id" uuid,
    	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
    	CONSTRAINT "app_admins_app_id_user_id_pk" PRIMARY KEY("app_id","user_id")
    );
    ALTER TABLE "app_admins" ADD CONSTRAINT "app_admins_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "app_admins" ADD CONSTRAINT "app_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "app_admins" ADD CONSTRAINT "app_admins_added_by_id_users_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
    CREATE INDEX "app_admins_user_idx" ON "app_admins" USING btree ("user_id");
  END IF;
END
$$;

-- Migration log entry (hash of drizzle/0022_app_admins.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '28cdd503d153431cca64eea8b5142c7b055346c2b8f6bb461c78416c73dcbeba', 1793278516729
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '28cdd503d153431cca64eea8b5142c7b055346c2b8f6bb461c78416c73dcbeba');

COMMIT;

-- Afterwards this should return one row, app_admins, with 4 columns:
-- SELECT table_name, count(*) AS columns FROM information_schema.columns WHERE table_name = 'app_admins' GROUP BY table_name;
