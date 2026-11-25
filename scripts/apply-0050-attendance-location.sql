-- Applies migration 0050 (Attendance: check in and out from anywhere, with the location recorded) to the live database, by hand. Paste the
-- whole file into the SQL Editor of the database production uses (DB_DRIVER "pg" in Vercel = Supabase, otherwise Neon; the database
-- DATABASE_URL points to) and run it BEFORE the code on feat/attendance-remote-checkin is deployed. It needs migration 0044 first
-- (scripts/apply-0044-attendance.sql): it changes its att_attendance table.
--
-- Safe to run more than once, and it changes no existing row:
--   - one NEW type, att_punch_place ('in_office', 'remote');
--   - eleven NEW nullable columns on att_attendance: the check-in's accuracy, place, distance from the office and area, and the same for
--     the check-out with its coordinates and IP. Existing rows keep NULL there (the code reads their place from the method they have).
--   - everything is in one transaction.
--   - the code running in production today never reads these columns, so it keeps working, and so does Instant Rollback.
--
-- To undo it (throws away the locations recorded since):
--   ALTER TABLE att_attendance DROP COLUMN IF EXISTS check_in_accuracy_m, DROP COLUMN IF EXISTS check_in_place,
--     DROP COLUMN IF EXISTS check_in_distance_m, DROP COLUMN IF EXISTS check_in_area, DROP COLUMN IF EXISTS check_out_lat,
--     DROP COLUMN IF EXISTS check_out_lng, DROP COLUMN IF EXISTS check_out_ip, DROP COLUMN IF EXISTS check_out_accuracy_m,
--     DROP COLUMN IF EXISTS check_out_place, DROP COLUMN IF EXISTS check_out_distance_m, DROP COLUMN IF EXISTS check_out_area;
--   DROP TYPE IF EXISTS att_punch_place;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '3ba2d77e3d4e249a0226ab700eab928284b9ecb60b2a2548ebe9fd1e0334b67d';

BEGIN;

DO $$ BEGIN
  CREATE TYPE "public"."att_punch_place" AS ENUM('in_office', 'remote');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "att_attendance" ADD COLUMN IF NOT EXISTS "check_in_accuracy_m" double precision;
ALTER TABLE "att_attendance" ADD COLUMN IF NOT EXISTS "check_in_place" "att_punch_place";
ALTER TABLE "att_attendance" ADD COLUMN IF NOT EXISTS "check_in_distance_m" integer;
ALTER TABLE "att_attendance" ADD COLUMN IF NOT EXISTS "check_in_area" text;
ALTER TABLE "att_attendance" ADD COLUMN IF NOT EXISTS "check_out_lat" double precision;
ALTER TABLE "att_attendance" ADD COLUMN IF NOT EXISTS "check_out_lng" double precision;
ALTER TABLE "att_attendance" ADD COLUMN IF NOT EXISTS "check_out_ip" text;
ALTER TABLE "att_attendance" ADD COLUMN IF NOT EXISTS "check_out_accuracy_m" double precision;
ALTER TABLE "att_attendance" ADD COLUMN IF NOT EXISTS "check_out_place" "att_punch_place";
ALTER TABLE "att_attendance" ADD COLUMN IF NOT EXISTS "check_out_distance_m" integer;
ALTER TABLE "att_attendance" ADD COLUMN IF NOT EXISTS "check_out_area" text;

-- Records the migration as applied, so drizzle-kit migrate never runs it again.
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '3ba2d77e3d4e249a0226ab700eab928284b9ecb60b2a2548ebe9fd1e0334b67d', 1795586128916
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '3ba2d77e3d4e249a0226ab700eab928284b9ecb60b2a2548ebe9fd1e0334b67d');

COMMIT;

-- Afterwards this should return 11 (the new columns) and 1 (the new type):
-- SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'att_attendance'
--           AND column_name IN ('check_in_accuracy_m', 'check_in_place', 'check_in_distance_m', 'check_in_area', 'check_out_lat',
--                               'check_out_lng', 'check_out_ip', 'check_out_accuracy_m', 'check_out_place', 'check_out_distance_m',
--                               'check_out_area')) AS new_columns,
--        (SELECT count(*) FROM pg_type WHERE typname = 'att_punch_place') AS place_type;
