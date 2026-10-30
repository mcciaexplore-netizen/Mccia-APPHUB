-- Applies migration 0024 (an index on inventory_stock_movements.vendor_id) to the live database, by hand.
-- Paste the whole file into the SQL Editor of the database production uses (Neon: project APPHUB, PRODUCTION branch; or Supabase if
-- the hub has moved there) and run it. It can run before or after the code is deployed: the code does not need it, it only makes the
-- Inventory Vendors page (and deleting a vendor) fast, instead of reading the whole stock history once per vendor.
-- Needs migration 0021 (the Inventory tables) to be there already. It does not need 0023.
--
-- Additive only, and safe to run more than once:
--   - it only CREATES one index. No table, column or row is changed.
--   - the index and the migration log entry are each added only if they are not there yet.
--   - building it briefly holds back writes to inventory_stock_movements; the table is small, so this takes well under a second.
--
-- To undo it:
--   DROP INDEX inventory_movements_vendor_idx;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = 'bf44a9a97027e31ada7c8ca6c1af6f40f72acdb140fecc54c52df3d2d4d929e9';

BEGIN;

CREATE INDEX IF NOT EXISTS "inventory_movements_vendor_idx" ON "inventory_stock_movements" USING btree ("vendor_id");

-- Migration log entry (hash of drizzle/0024_inventory_vendor_index.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT 'bf44a9a97027e31ada7c8ca6c1af6f40f72acdb140fecc54c52df3d2d4d929e9', 1793344827776
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'bf44a9a97027e31ada7c8ca6c1af6f40f72acdb140fecc54c52df3d2d4d929e9');

COMMIT;

-- Afterwards this should return one row, inventory_movements_vendor_idx:
-- SELECT indexname FROM pg_indexes WHERE tablename = 'inventory_stock_movements' AND indexname = 'inventory_movements_vendor_idx';
