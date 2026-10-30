-- Applies migration 0023 (app_staff: who is staff of each application) to the live database, by hand.
-- Paste the whole file into the SQL Editor of the database production uses (Neon: project APPHUB, PRODUCTION branch; or Supabase if
-- the hub has moved there) and run it BEFORE the App Staff code is deployed: the new code reads this table on the Applications page and
-- when opening a single sign-on application.
--
-- Additive only, and safe to run more than once:
--   - it only CREATES the table app_staff (with its keys and one index). No existing table, column or row is changed or read.
--   - everything is created together in one transaction, and only if app_staff is not there yet.
--   - the code running in production today never mentions app_staff, so it keeps working unchanged after this runs.
--   - the migration log entry is added only if it is not there yet.
--
-- To undo it before anyone has been made App Staff:
--   DROP TABLE app_staff;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '3c45af42304fb115a9d0f6c8a0dd18655f8943b18f73c9e237767aa1f36509fc';

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.app_staff') IS NULL THEN
    CREATE TABLE "app_staff" (
    	"app_id" uuid NOT NULL,
    	"user_id" uuid NOT NULL,
    	"added_by_id" uuid,
    	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
    	CONSTRAINT "app_staff_app_id_user_id_pk" PRIMARY KEY("app_id","user_id")
    );
    ALTER TABLE "app_staff" ADD CONSTRAINT "app_staff_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "app_staff" ADD CONSTRAINT "app_staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "app_staff" ADD CONSTRAINT "app_staff_added_by_id_users_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
    CREATE INDEX "app_staff_user_idx" ON "app_staff" USING btree ("user_id");
  END IF;
END
$$;

-- Migration log entry (hash of drizzle/0023_app_staff.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '3c45af42304fb115a9d0f6c8a0dd18655f8943b18f73c9e237767aa1f36509fc', 1793344239339
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '3c45af42304fb115a9d0f6c8a0dd18655f8943b18f73c9e237767aa1f36509fc');

COMMIT;

-- Afterwards this should return one row, app_staff, with 4 columns:
-- SELECT table_name, count(*) AS columns FROM information_schema.columns WHERE table_name = 'app_staff' GROUP BY table_name;
