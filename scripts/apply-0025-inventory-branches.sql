-- Applies migration 0025 (Inventory stock per branch) to the live database, by hand.
-- Paste the whole file into the SQL Editor of the database production uses (Neon: project APPHUB, PRODUCTION branch; or Supabase if
-- the hub has moved there) and run it BEFORE the branch code is deployed: the new code reads and writes these columns and tables.
--
-- STEP 1: type the exact name of the default branch (as it appears in Administrator → Branches) on the line marked >>> below.
--         Every existing item, all existing stock and every existing stock movement go to that branch; each existing request goes to
--         its requester's branch, or to the default branch if they have none. The script stops with an error, changing nothing, if the
--         name is empty or not found and there is data that needs it.
-- STEP 2: run it. It is one transaction: all of it applies, or (on any error) none of it.
--
-- Safe to run more than once: tables, columns, constraints and indexes are only created if missing, and only rows that still have no
-- branch are filled in (so a second run needs no branch name).
--
-- What it changes:
--   - new tables inventory_branch_stock (each branch's quantity and low-stock level per item) and inventory_transfers
--   - new column branch_id on inventory_items (optional), inventory_stock_movements and inventory_requests (required once filled in)
--   - a new movement kind, 'transfer'
--   No hub table is changed. The code running in production today keeps working after this runs: it never reads the new columns, and
--   inventory_items.quantity stays the total. But until the new code is deployed, anything it records (a new request, an issue, a receipt)
--   has no branch and would be refused once the columns are required, so deploy straight after running this.
--
-- To undo it (before the new code is deployed, or after rolling the code back):
--   DROP TABLE inventory_transfers; DROP TABLE inventory_branch_stock;
--   ALTER TABLE inventory_stock_movements DROP COLUMN branch_id; ALTER TABLE inventory_requests DROP COLUMN branch_id;
--   ALTER TABLE inventory_items DROP COLUMN branch_id;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '5136e7cf4cb481e0082d6f8b0b8b2b3eb513d17f8de008186d6d147e2dd0acba';
--   (The 'transfer' movement kind stays; it is harmless. Delete any 'transfer' movements first if any were made.)

BEGIN;

ALTER TYPE "public"."inventory_movement_kind" ADD VALUE IF NOT EXISTS 'transfer';

CREATE TABLE IF NOT EXISTS "inventory_branch_stock" (
	"item_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"min_quantity" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "inventory_branch_stock_item_id_branch_id_pk" PRIMARY KEY("item_id","branch_id"),
	CONSTRAINT "inventory_branch_stock_quantity_check" CHECK ("inventory_branch_stock"."quantity" >= 0)
);

CREATE TABLE IF NOT EXISTS "inventory_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"from_branch_id" uuid NOT NULL,
	"to_branch_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"reason" text,
	"actor_id" uuid NOT NULL,
	"actor_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_transfers_quantity_check" CHECK ("inventory_transfers"."quantity" > 0)
);

ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "branch_id" uuid;
ALTER TABLE "inventory_requests" ADD COLUMN IF NOT EXISTS "branch_id" uuid;
ALTER TABLE "inventory_stock_movements" ADD COLUMN IF NOT EXISTS "branch_id" uuid;

DO $$
DECLARE
  default_branch_name text := '';   -- >>> type the default branch's exact name between the quotes, e.g. 'Pune Head Office'
  d uuid;
  names text;
BEGIN
  IF EXISTS (SELECT 1 FROM inventory_items WHERE branch_id IS NULL)
     OR EXISTS (SELECT 1 FROM inventory_stock_movements WHERE branch_id IS NULL)
     OR EXISTS (SELECT 1 FROM inventory_requests WHERE branch_id IS NULL)
     OR EXISTS (SELECT 1 FROM inventory_items i WHERE NOT EXISTS (SELECT 1 FROM inventory_branch_stock b WHERE b.item_id = i.id)) THEN
    SELECT id INTO d FROM branches WHERE lower(trim(name)) = lower(trim(default_branch_name));
    IF d IS NULL THEN
      SELECT string_agg(quote_literal(name), ', ' ORDER BY name) INTO names FROM branches;
      RAISE EXCEPTION 'Default branch % not found. Type one of these names on the line marked >>> and run again: %', quote_literal(default_branch_name), coalesce(names, '(there are no branches yet: add one in Administrator first)');
    END IF;
    UPDATE inventory_items SET branch_id = d WHERE branch_id IS NULL;
    UPDATE inventory_stock_movements SET branch_id = d WHERE branch_id IS NULL;
    UPDATE inventory_requests r SET branch_id = coalesce((SELECT u.branch_id FROM users u WHERE u.id = r.requested_by_user_id), d) WHERE r.branch_id IS NULL;
    -- Each item's stock so far is at the default branch, with its low-stock level.
    INSERT INTO inventory_branch_stock (item_id, branch_id, quantity, min_quantity)
    SELECT i.id, d, i.quantity, i.min_quantity FROM inventory_items i WHERE NOT EXISTS (SELECT 1 FROM inventory_branch_stock b WHERE b.item_id = i.id);
  END IF;
END
$$;

ALTER TABLE "inventory_requests" ALTER COLUMN "branch_id" SET NOT NULL;
ALTER TABLE "inventory_stock_movements" ALTER COLUMN "branch_id" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_branch_stock_item_id_inventory_items_id_fk') THEN
    ALTER TABLE "inventory_branch_stock" ADD CONSTRAINT "inventory_branch_stock_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_branch_stock_branch_id_branches_id_fk') THEN
    ALTER TABLE "inventory_branch_stock" ADD CONSTRAINT "inventory_branch_stock_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transfers_item_id_inventory_items_id_fk') THEN
    ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transfers_from_branch_id_branches_id_fk') THEN
    ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_from_branch_id_branches_id_fk" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transfers_to_branch_id_branches_id_fk') THEN
    ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_to_branch_id_branches_id_fk" FOREIGN KEY ("to_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_items_branch_id_branches_id_fk') THEN
    ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_requests_branch_id_branches_id_fk') THEN
    ALTER TABLE "inventory_requests" ADD CONSTRAINT "inventory_requests_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_stock_movements_branch_id_branches_id_fk') THEN
    ALTER TABLE "inventory_stock_movements" ADD CONSTRAINT "inventory_stock_movements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "inventory_branch_stock_branch_idx" ON "inventory_branch_stock" USING btree ("branch_id");
CREATE INDEX IF NOT EXISTS "inventory_transfers_created_idx" ON "inventory_transfers" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "inventory_transfers_item_idx" ON "inventory_transfers" USING btree ("item_id");
CREATE INDEX IF NOT EXISTS "inventory_requests_branch_idx" ON "inventory_requests" USING btree ("branch_id","status");
CREATE INDEX IF NOT EXISTS "inventory_movements_branch_idx" ON "inventory_stock_movements" USING btree ("branch_id","created_at");

-- Migration log entry (hash of drizzle/0025_inventory_branches.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '5136e7cf4cb481e0082d6f8b0b8b2b3eb513d17f8de008186d6d147e2dd0acba', 1793359705009
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '5136e7cf4cb481e0082d6f8b0b8b2b3eb513d17f8de008186d6d147e2dd0acba');

COMMIT;

-- Afterwards this should return one row with every count 0 (nothing left without a branch) and stock_matches = true:
-- SELECT
--   (SELECT count(*) FROM inventory_items WHERE branch_id IS NULL) AS items_without_branch,
--   (SELECT count(*) FROM inventory_requests WHERE branch_id IS NULL) AS requests_without_branch,
--   (SELECT count(*) FROM inventory_stock_movements WHERE branch_id IS NULL) AS movements_without_branch,
--   (SELECT count(*) FROM inventory_items i WHERE NOT EXISTS (SELECT 1 FROM inventory_branch_stock b WHERE b.item_id = i.id)) AS items_without_stock_row,
--   (SELECT coalesce(sum(quantity), 0) FROM inventory_items) = (SELECT coalesce(sum(quantity), 0) FROM inventory_branch_stock) AS stock_matches;
