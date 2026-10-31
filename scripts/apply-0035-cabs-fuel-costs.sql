-- Applies migration 0035 (Cab Booking: fuel costs on Payments, and the "driver asked for a login OTP" flag on Drivers) to the live
-- database, by hand. Paste the whole file into the SQL Editor of the database production uses (check DB_DRIVER in Vercel: "pg" means
-- Supabase, otherwise Neon; and use the database DATABASE_URL points to) and run it BEFORE this code is deployed. Migrations 0028 to 0033
-- must have been applied first (0034 may or may not have been: this does not depend on it).
--
-- Safe to run more than once, and it changes no existing row:
--   - a new table, cab_fuel_costs, with its two indexes.
--   - one new, empty column on cab_drivers: login_requested_at (NULL for every driver until one asks for a login OTP).
--   - everything is in one transaction.
--   - the Cab Booking code running in production today never reads either, so it keeps working, and so does Instant Rollback.
--
-- To undo it (throws away any fuel costs recorded):
--   DROP TABLE IF EXISTS cab_fuel_costs;
--   ALTER TABLE cab_drivers DROP COLUMN IF EXISTS login_requested_at;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = 'c343acc17a95dc5f3181f14cfc205a033bef1b9bdfe8eba7ffdf007c0515f536';

BEGIN;

CREATE TABLE IF NOT EXISTS "cab_fuel_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"vehicle_plate" text NOT NULL,
	"litres" numeric(8, 2) NOT NULL,
	"cost_paise" integer NOT NULL,
	"fuelled_at" timestamp with time zone NOT NULL,
	"station_name" text,
	"recorded_by_id" uuid NOT NULL,
	"recorded_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "cab_drivers" ADD COLUMN IF NOT EXISTS "login_requested_at" timestamp with time zone;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cab_fuel_costs_vehicle_id_cab_vehicles_id_fk') THEN
    ALTER TABLE "cab_fuel_costs" ADD CONSTRAINT "cab_fuel_costs_vehicle_id_cab_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."cab_vehicles"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "cab_fuel_costs_vehicle_idx" ON "cab_fuel_costs" USING btree ("vehicle_id","fuelled_at" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "cab_fuel_costs_fuelled_idx" ON "cab_fuel_costs" USING btree ("fuelled_at" DESC NULLS LAST);

-- Migration log entry (hash of drizzle/0035_cabs_fuel_costs.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT 'c343acc17a95dc5f3181f14cfc205a033bef1b9bdfe8eba7ffdf007c0515f536', 1793431052899
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'c343acc17a95dc5f3181f14cfc205a033bef1b9bdfe8eba7ffdf007c0515f536');

COMMIT;

-- Afterwards this should return two rows: cab_drivers | login_requested_at and cab_fuel_costs | fuelled_at
-- SELECT table_name, column_name FROM information_schema.columns
-- WHERE (table_name = 'cab_drivers' AND column_name = 'login_requested_at') OR (table_name = 'cab_fuel_costs' AND column_name = 'fuelled_at') ORDER BY 1;
