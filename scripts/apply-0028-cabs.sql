-- Applies migration 0028 (the Cab Booking module: cab_vehicles, cab_drivers, cab_rides, cab_audit_log) to the live database, by hand.
-- Paste the whole file into the SQL Editor of the database production uses (check DB_DRIVER in Vercel: "pg" means Supabase, otherwise
-- Neon; and use the database DATABASE_URL points to) and run it BEFORE the Cab Booking code is deployed.
--
-- Additive only, and safe to run more than once:
--   - it only CREATES the type cab_ride_status, four cab_ tables, their foreign keys (between cab_ tables only) and indexes. No existing
--     table, column or row is changed, and nothing points at the hub's users table (drivers are a name, an email and a phone, not hub users).
--   - everything is in one transaction, and each part only if it is not there yet.
--   - the code running in production today never mentions these tables, so it keeps working unchanged after this runs.
--   - the module stays off (every /cabs page 404s) until CABS_ENABLED=true is set in Vercel.
--
-- To undo it (only while no real rides matter; this deletes every ride, driver and vehicle):
--   DROP TABLE cab_audit_log, cab_rides, cab_drivers, cab_vehicles;
--   DROP TYPE cab_ride_status;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '36966b20aecc718d236bd88dd8c7aec3f48be979c4870bf40390a35215884b64';

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cab_ride_status') THEN
    CREATE TYPE "public"."cab_ride_status" AS ENUM('pending', 'assigned', 'in_progress', 'completed', 'cancelled');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "cab_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number_plate" text NOT NULL,
	"model" text NOT NULL,
	"capacity" integer DEFAULT 4 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cab_vehicles_number_plate_unique" UNIQUE("number_plate")
);

CREATE TABLE IF NOT EXISTS "cab_drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"vehicle_id" uuid,
	"is_available" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cab_drivers_email_unique" UNIQUE("email")
);

CREATE TABLE IF NOT EXISTS "cab_rides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by_id" uuid NOT NULL,
	"requested_by_name" text NOT NULL,
	"requested_by_email" text NOT NULL,
	"requested_by_branch" text,
	"driver_id" uuid,
	"vehicle_id" uuid,
	"driver_name" text,
	"vehicle_plate" text,
	"pickup" text NOT NULL,
	"dropoff" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" "cab_ride_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"assigned_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_name" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "cab_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_name" text NOT NULL,
	"ride_id" uuid,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cab_audit_log_ride_id_cab_rides_id_fk') THEN
    ALTER TABLE "cab_audit_log" ADD CONSTRAINT "cab_audit_log_ride_id_cab_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."cab_rides"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cab_drivers_vehicle_id_cab_vehicles_id_fk') THEN
    ALTER TABLE "cab_drivers" ADD CONSTRAINT "cab_drivers_vehicle_id_cab_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."cab_vehicles"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cab_rides_driver_id_cab_drivers_id_fk') THEN
    ALTER TABLE "cab_rides" ADD CONSTRAINT "cab_rides_driver_id_cab_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."cab_drivers"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cab_rides_vehicle_id_cab_vehicles_id_fk') THEN
    ALTER TABLE "cab_rides" ADD CONSTRAINT "cab_rides_vehicle_id_cab_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."cab_vehicles"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "cab_audit_log_created_idx" ON "cab_audit_log" USING btree ("created_at" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "cab_audit_log_ride_idx" ON "cab_audit_log" USING btree ("ride_id");
CREATE INDEX IF NOT EXISTS "cab_rides_status_idx" ON "cab_rides" USING btree ("status");
CREATE INDEX IF NOT EXISTS "cab_rides_scheduled_idx" ON "cab_rides" USING btree ("scheduled_for");
CREATE INDEX IF NOT EXISTS "cab_rides_driver_idx" ON "cab_rides" USING btree ("driver_id");
CREATE INDEX IF NOT EXISTS "cab_rides_requested_by_idx" ON "cab_rides" USING btree ("requested_by_id");

-- Migration log entry (hash of drizzle/0028_cabs.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '36966b20aecc718d236bd88dd8c7aec3f48be979c4870bf40390a35215884b64', 1793380003144
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '36966b20aecc718d236bd88dd8c7aec3f48be979c4870bf40390a35215884b64');

COMMIT;

-- Afterwards this should return four rows: cab_audit_log 7, cab_drivers 7, cab_rides 22, cab_vehicles 6 (table name, number of columns):
-- SELECT table_name, count(*) AS columns FROM information_schema.columns WHERE table_name LIKE 'cab\_%' GROUP BY table_name ORDER BY table_name;
