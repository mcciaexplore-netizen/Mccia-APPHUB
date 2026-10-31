-- Applies migration 0033 (Cab Booking: drivers sign in to Cabs Driver with their phone and a one-time code from an admin) to the live
-- database, by hand. Paste the whole file into the SQL Editor of the database production uses (check DB_DRIVER in Vercel: "pg" means
-- Supabase, otherwise Neon; and use the database DATABASE_URL points to) and run it BEFORE this code is deployed. Migrations 0028 to 0032
-- must have been applied first.
--
-- Safe to run more than once, and it changes no existing table or row:
--   - it only adds two new tables, cab_driver_otps (the codes, kept as a keyed SHA-256, never the digits) and cab_driver_sessions (a
--     driver's 12-hour sign-in, kept as the SHA-256 of the cookie's value), with their indexes.
--   - everything is in one transaction.
--   - the Cab Booking code running in production today never reads these tables, so it keeps working, and so does Instant Rollback.
--   - cab_drivers.vehicle_id is NOT dropped here: that is 0034, to be run only after this deploy is confirmed working.
--
-- To undo it (signs every phone driver out and throws away unused codes):
--   DROP TABLE IF EXISTS cab_driver_sessions;
--   DROP TABLE IF EXISTS cab_driver_otps;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '9832391df08a4a9065ad821042506ec30552d08a48ea1131c19ee920a413ded3';

BEGIN;

CREATE TABLE IF NOT EXISTS "cab_driver_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"otp_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"used_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "cab_driver_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cab_driver_sessions_token_unique" UNIQUE("token")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cab_driver_otps_driver_id_cab_drivers_id_fk') THEN
    ALTER TABLE "cab_driver_otps" ADD CONSTRAINT "cab_driver_otps_driver_id_cab_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."cab_drivers"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cab_driver_sessions_driver_id_cab_drivers_id_fk') THEN
    ALTER TABLE "cab_driver_sessions" ADD CONSTRAINT "cab_driver_sessions_driver_id_cab_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."cab_drivers"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "cab_driver_otps_driver_idx" ON "cab_driver_otps" USING btree ("driver_id","created_at" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "cab_driver_otps_expires_idx" ON "cab_driver_otps" USING btree ("expires_at");
CREATE INDEX IF NOT EXISTS "cab_driver_sessions_driver_idx" ON "cab_driver_sessions" USING btree ("driver_id");
CREATE INDEX IF NOT EXISTS "cab_driver_sessions_expires_idx" ON "cab_driver_sessions" USING btree ("expires_at");

-- Migration log entry (hash of drizzle/0033_cabs_driver_login.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '9832391df08a4a9065ad821042506ec30552d08a48ea1131c19ee920a413ded3', 1793426062044
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '9832391df08a4a9065ad821042506ec30552d08a48ea1131c19ee920a413ded3');

COMMIT;

-- Afterwards this should return two rows: cab_driver_otps | 9 and cab_driver_sessions | 5
-- SELECT table_name, count(*) FROM information_schema.columns WHERE table_name IN ('cab_driver_otps', 'cab_driver_sessions') GROUP BY table_name ORDER BY table_name;
