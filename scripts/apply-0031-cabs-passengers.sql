-- Applies migration 0031 (Cab Booking: passengers, trip type, multi-day end and stops on each ride) to the live database, by hand.
-- Paste the whole file into the SQL Editor of the database production uses (check DB_DRIVER in Vercel: "pg" means Supabase, otherwise
-- Neon; and use the database DATABASE_URL points to) and run it BEFORE this code is deployed. Migrations 0028 to 0030 must have been
-- applied first.
--
-- Additive only, and safe to run more than once:
--   - it ADDS four columns to cab_rides, each with a default, so every existing ride gets a sensible value (1 passenger, a "scheduled"
--     trip, no end date, no stops). No row is otherwise changed, and no hub table is touched.
--   - everything is in one transaction, and each column only if it is not there yet.
--   - the Cab Booking code running in production today never reads these columns, so it keeps working unchanged after this runs.
--
-- To undo it:
--   ALTER TABLE cab_rides DROP COLUMN trip_type, DROP COLUMN ends_at, DROP COLUMN stops, DROP COLUMN passengers;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '219348aef92b328782786031afbeaf6abfd5776512d79ff44377c143637522ba';

BEGIN;

ALTER TABLE "cab_rides" ADD COLUMN IF NOT EXISTS "trip_type" text DEFAULT 'scheduled' NOT NULL;
ALTER TABLE "cab_rides" ADD COLUMN IF NOT EXISTS "ends_at" timestamp with time zone;
ALTER TABLE "cab_rides" ADD COLUMN IF NOT EXISTS "stops" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "cab_rides" ADD COLUMN IF NOT EXISTS "passengers" integer DEFAULT 1 NOT NULL;

-- Migration log entry (hash of drizzle/0031_cabs_passengers.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '219348aef92b328782786031afbeaf6abfd5776512d79ff44377c143637522ba', 1793388439797
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '219348aef92b328782786031afbeaf6abfd5776512d79ff44377c143637522ba');

COMMIT;

-- Afterwards this should return four rows: ends_at, passengers, stops, trip_type (the new columns of cab_rides, which has 31 in all):
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'cab_rides' AND column_name IN ('passengers', 'trip_type', 'ends_at', 'stops') ORDER BY column_name;
