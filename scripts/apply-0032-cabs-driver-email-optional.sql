-- Applies migration 0032 (Cab Booking: a driver's email becomes optional; a driver's phone number is unique) to the live database, by hand.
-- Paste the whole file into the SQL Editor of the database production uses (check DB_DRIVER in Vercel: "pg" means Supabase, otherwise
-- Neon; and use the database DATABASE_URL points to) and run it BEFORE this code is deployed. Migrations 0028 to 0031 must have been
-- applied first.
--
-- Safe to run more than once, and it changes no row:
--   - cab_drivers.email may now be empty (NULL). A column with no default is already NULL by default, so no default is set.
--   - cab_drivers.phone becomes unique, so the same driver cannot be added twice. If two drivers already share a phone number, the
--     script stops at that point with a message naming the number, and nothing is changed (fix the duplicate on Cabs Admin → Drivers,
--     then run it again).
--   - everything is in one transaction.
--   - the Cab Booking code running in production today keeps working: it always gives an email, and never repeats a phone.
--
-- To undo it (only while every driver still has an email):
--   ALTER TABLE cab_drivers DROP CONSTRAINT cab_drivers_phone_unique;
--   ALTER TABLE cab_drivers ALTER COLUMN email SET NOT NULL;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = 'ed6894d6af4e910130153145e00e48f97c07be23e357bfbbfea27fe5213f78de';

BEGIN;

ALTER TABLE "cab_drivers" ALTER COLUMN "email" DROP NOT NULL;

DO $$
DECLARE dup text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cab_drivers_phone_unique') THEN
    SELECT phone INTO dup FROM cab_drivers GROUP BY phone HAVING count(*) > 1 LIMIT 1;
    IF dup IS NOT NULL THEN
      RAISE EXCEPTION 'Two or more drivers have the phone number %. Remove or correct the duplicate on Cabs Admin → Drivers, then run this script again.', dup;
    END IF;
    ALTER TABLE "cab_drivers" ADD CONSTRAINT "cab_drivers_phone_unique" UNIQUE("phone");
  END IF;
END
$$;

-- Migration log entry (hash of drizzle/0032_cabs_driver_email_optional.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT 'ed6894d6af4e910130153145e00e48f97c07be23e357bfbbfea27fe5213f78de', 1793393817491
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'ed6894d6af4e910130153145e00e48f97c07be23e357bfbbfea27fe5213f78de');

COMMIT;

-- Afterwards this should return one row: email | YES | cab_drivers_phone_unique
-- SELECT c.column_name, c.is_nullable, (SELECT conname FROM pg_constraint WHERE conname = 'cab_drivers_phone_unique') AS phone_rule
-- FROM information_schema.columns c WHERE c.table_name = 'cab_drivers' AND c.column_name = 'email';
