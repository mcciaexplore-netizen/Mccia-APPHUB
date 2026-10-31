-- Applies migration 0034 (Cab Booking: drivers no longer have a car of their own; the car is chosen for each ride) to the live database,
-- by hand. Paste the whole file into the SQL Editor of the database production uses (check DB_DRIVER in Vercel: "pg" means Supabase,
-- otherwise Neon; and use the database DATABASE_URL points to).
--
-- Run it only AFTER the deploy with driver phone sign-in (migration 0033) is live and confirmed working. Code from before that deploy reads
-- cab_drivers.vehicle_id, so once this has run, an Instant Rollback to such a deploy breaks Cabs Admin → Drivers, Vehicles and the fleet map.
-- The new code never reads the column, so there is no hurry: it can wait as long as you like.
--
-- Safe to run more than once. It drops one column, cab_drivers.vehicle_id (each driver's "usual car"), and its foreign key. Rides are
-- not touched: each ride keeps its own vehicle_id and vehicle_plate. Everything is in one transaction.
--
-- To undo it (the column comes back empty; nothing reads it any more):
--   ALTER TABLE cab_drivers ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES cab_vehicles(id) ON DELETE SET NULL;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = 'bf241c7f7a21b5561da7dcb17bf888aa5f846fe252085c0f8af4f78aaa4d6538';

BEGIN;

ALTER TABLE "cab_drivers" DROP CONSTRAINT IF EXISTS "cab_drivers_vehicle_id_cab_vehicles_id_fk";
ALTER TABLE "cab_drivers" DROP COLUMN IF EXISTS "vehicle_id";

-- Migration log entry (hash of drizzle/0034_cabs_drop_driver_vehicle.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT 'bf241c7f7a21b5561da7dcb17bf888aa5f846fe252085c0f8af4f78aaa4d6538', 1793426066841
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'bf241c7f7a21b5561da7dcb17bf888aa5f846fe252085c0f8af4f78aaa4d6538');

COMMIT;

-- Afterwards this should return no rows:
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'cab_drivers' AND column_name = 'vehicle_id';
