-- Applies migration 0029 (Cab Booking phase 2: ride OTPs, drivers' live positions, ride coordinates) to the live database, by hand.
-- Paste the whole file into the SQL Editor of the database production uses (check DB_DRIVER in Vercel: "pg" means Supabase, otherwise
-- Neon; and use the database DATABASE_URL points to) and run it BEFORE this code is deployed. Migration 0028 (apply-0028-cabs.sql) must
-- have been applied first.
--
-- Additive only, and safe to run more than once:
--   - it CREATES cab_ride_otps and cab_driver_locations (with foreign keys to cab_ tables only, and three indexes), and ADDS five empty
--     columns to cab_rides (pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, otp_verified_at). No row is changed, and no hub table is touched.
--   - everything is in one transaction, and each part only if it is not there yet.
--   - the Cab Booking code running in production today never reads these, so it keeps working unchanged after this runs.
--
-- To undo it (this deletes every OTP and every recorded position):
--   DROP TABLE cab_driver_locations, cab_ride_otps;
--   ALTER TABLE cab_rides DROP COLUMN pickup_lat, DROP COLUMN pickup_lng, DROP COLUMN dropoff_lat, DROP COLUMN dropoff_lng, DROP COLUMN otp_verified_at;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = 'ce2a66f80f4e84ba598ae7f111774062969d0cb0d35c29514b8ef9c46423013c';

BEGIN;

CREATE TABLE IF NOT EXISTS "cab_driver_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"latitude" numeric(10, 7) NOT NULL,
	"longitude" numeric(10, 7) NOT NULL,
	"accuracy" real,
	"heading" real,
	"speed" real,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ride_id" uuid
);

CREATE TABLE IF NOT EXISTS "cab_ride_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"otp" char(4) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cab_ride_otps_ride_id_unique" UNIQUE("ride_id")
);

ALTER TABLE "cab_rides" ADD COLUMN IF NOT EXISTS "pickup_lat" numeric(10, 7);
ALTER TABLE "cab_rides" ADD COLUMN IF NOT EXISTS "pickup_lng" numeric(10, 7);
ALTER TABLE "cab_rides" ADD COLUMN IF NOT EXISTS "dropoff_lat" numeric(10, 7);
ALTER TABLE "cab_rides" ADD COLUMN IF NOT EXISTS "dropoff_lng" numeric(10, 7);
ALTER TABLE "cab_rides" ADD COLUMN IF NOT EXISTS "otp_verified_at" timestamp with time zone;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cab_driver_locations_driver_id_cab_drivers_id_fk') THEN
    ALTER TABLE "cab_driver_locations" ADD CONSTRAINT "cab_driver_locations_driver_id_cab_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."cab_drivers"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cab_driver_locations_ride_id_cab_rides_id_fk') THEN
    ALTER TABLE "cab_driver_locations" ADD CONSTRAINT "cab_driver_locations_ride_id_cab_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."cab_rides"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cab_ride_otps_ride_id_cab_rides_id_fk') THEN
    ALTER TABLE "cab_ride_otps" ADD CONSTRAINT "cab_ride_otps_ride_id_cab_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."cab_rides"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "cab_driver_locations_driver_idx" ON "cab_driver_locations" USING btree ("driver_id","recorded_at" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "cab_driver_locations_ride_idx" ON "cab_driver_locations" USING btree ("ride_id");
CREATE INDEX IF NOT EXISTS "cab_driver_locations_recorded_idx" ON "cab_driver_locations" USING btree ("recorded_at" DESC NULLS LAST);

-- Migration log entry (hash of drizzle/0029_cabs_tracking.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT 'ce2a66f80f4e84ba598ae7f111774062969d0cb0d35c29514b8ef9c46423013c', 1793384813278
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'ce2a66f80f4e84ba598ae7f111774062969d0cb0d35c29514b8ef9c46423013c');

COMMIT;

-- Afterwards this should return three rows: cab_driver_locations 9, cab_ride_otps 7, cab_rides 27 (table name, number of columns):
-- SELECT table_name, count(*) AS columns FROM information_schema.columns WHERE table_name IN ('cab_driver_locations', 'cab_ride_otps', 'cab_rides') GROUP BY table_name ORDER BY table_name;
