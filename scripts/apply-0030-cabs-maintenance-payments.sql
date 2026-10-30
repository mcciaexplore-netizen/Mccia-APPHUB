-- Applies migration 0030 (Cab Booking phase 3: vehicle maintenance, ride costs and invoices) to the live database, by hand.
-- Paste the whole file into the SQL Editor of the database production uses (check DB_DRIVER in Vercel: "pg" means Supabase, otherwise
-- Neon; and use the database DATABASE_URL points to) and run it BEFORE this code is deployed. Migrations 0028 and 0029
-- (apply-0028-cabs.sql, apply-0029-cabs-tracking.sql) must have been applied first.
--
-- Additive only, and safe to run more than once:
--   - it only CREATES cab_maintenance, cab_invoices and cab_ride_costs, their foreign keys (to cab_ tables only) and indexes. No existing
--     table, column or row is changed, and no hub table is touched.
--   - everything is in one transaction, and each part only if it is not there yet.
--   - the Cab Booking code running in production today never reads these, so it keeps working unchanged after this runs.
--
-- To undo it (this deletes every maintenance record, ride cost and invoice):
--   DROP TABLE cab_ride_costs, cab_invoices, cab_maintenance;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '941fdb70d51633a6a6e53858b20eda29eb2ffb59aab14876e5897012a781dc40';

BEGIN;

CREATE TABLE IF NOT EXISTS "cab_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_number" text NOT NULL,
	"branch" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"total_rides" integer DEFAULT 0 NOT NULL,
	"total_amount_paise" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_by_id" uuid NOT NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "cab_invoices_invoice_number_unique" UNIQUE("invoice_number")
);

CREATE TABLE IF NOT EXISTS "cab_maintenance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"vehicle_plate" text NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"cost_paise" integer,
	"done_at" timestamp with time zone NOT NULL,
	"done_by" text NOT NULL,
	"next_due_at" timestamp with time zone,
	"notes" text,
	"recorded_by_id" uuid NOT NULL,
	"recorded_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "cab_ride_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"base_fare_paise" integer DEFAULT 0 NOT NULL,
	"distance_km" numeric(8, 2),
	"notes" text,
	"recorded_by_id" uuid NOT NULL,
	"recorded_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invoice_id" uuid,
	CONSTRAINT "cab_ride_costs_ride_id_unique" UNIQUE("ride_id")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cab_maintenance_vehicle_id_cab_vehicles_id_fk') THEN
    ALTER TABLE "cab_maintenance" ADD CONSTRAINT "cab_maintenance_vehicle_id_cab_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."cab_vehicles"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cab_ride_costs_ride_id_cab_rides_id_fk') THEN
    ALTER TABLE "cab_ride_costs" ADD CONSTRAINT "cab_ride_costs_ride_id_cab_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."cab_rides"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cab_ride_costs_invoice_id_cab_invoices_id_fk') THEN
    ALTER TABLE "cab_ride_costs" ADD CONSTRAINT "cab_ride_costs_invoice_id_cab_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."cab_invoices"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "cab_invoices_status_idx" ON "cab_invoices" USING btree ("status","period_start");
CREATE INDEX IF NOT EXISTS "cab_maintenance_vehicle_idx" ON "cab_maintenance" USING btree ("vehicle_id","done_at" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "cab_maintenance_done_idx" ON "cab_maintenance" USING btree ("done_at" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "cab_ride_costs_invoice_idx" ON "cab_ride_costs" USING btree ("invoice_id");

-- Migration log entry (hash of drizzle/0030_cabs_maintenance_payments.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '941fdb70d51633a6a6e53858b20eda29eb2ffb59aab14876e5897012a781dc40', 1793386499746
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '941fdb70d51633a6a6e53858b20eda29eb2ffb59aab14876e5897012a781dc40');

COMMIT;

-- Afterwards this should return three rows: cab_invoices 13, cab_maintenance 13, cab_ride_costs 9 (table name, number of columns):
-- SELECT table_name, count(*) AS columns FROM information_schema.columns WHERE table_name IN ('cab_maintenance', 'cab_ride_costs', 'cab_invoices') GROUP BY table_name ORDER BY table_name;
