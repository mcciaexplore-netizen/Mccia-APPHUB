-- Applies migration 0052 (Inventory: Annual Maintenance Contracts) to the live database, by hand. Paste the whole file into the SQL Editor of
-- the database production uses (DB_DRIVER "pg" in Vercel = Supabase, otherwise Neon; the database DATABASE_URL points to) and run it BEFORE
-- the code on feat/inventory-amc is deployed. (The Inventory tables must already exist: scripts/apply-0021-inventory-in-neon-console.sql.)
--
-- Additive only, and safe to run more than once:
--   - it only CREATES the type inventory_amc_type, the table inventory_amc, its three foreign keys (to branches, inventory_categories and
--     inventory_vendors) and two indexes. No existing table, column or row is changed.
--   - the foreign keys: a branch cannot be deleted while it has contracts; deleting a category or a vendor only clears the link (the vendor's
--     name stays on the contract).
--   - everything is in one transaction, and each part only if it is not there yet.
--   - the code running in production today never mentions this table, so it keeps working, and so does Instant Rollback.
--
-- To put the SB Road contracts in afterwards: scripts/seed-inventory-amc-sb-road.sql.
--
-- To undo it (this deletes every contract):
--   DROP TABLE inventory_amc;
--   DROP TYPE inventory_amc_type;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '60b8e4f204b0935f284b76c726f34f1430d62c30cceeb718132c80f7744b3230';

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_amc_type') THEN
    CREATE TYPE "public"."inventory_amc_type" AS ENUM('comprehensive', 'non_comprehensive', 'service', 'cec');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "inventory_amc" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"branch_id" uuid NOT NULL,
	"category_id" uuid,
	"equipment_service" text NOT NULL,
	"vendor_name" text NOT NULL,
	"vendor_id" uuid,
	"amc_type" "inventory_amc_type" NOT NULL,
	"fy_start_year" integer NOT NULL,
	"start_date" date,
	"end_date" date,
	"amount_current_fy" bigint,
	"amount_next_fy" bigint,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_amc_branch_id_branches_id_fk') THEN
    ALTER TABLE "inventory_amc" ADD CONSTRAINT "inventory_amc_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_amc_category_id_inventory_categories_id_fk') THEN
    ALTER TABLE "inventory_amc" ADD CONSTRAINT "inventory_amc_category_id_inventory_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."inventory_categories"("id") ON DELETE set null ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_amc_vendor_id_inventory_vendors_id_fk') THEN
    ALTER TABLE "inventory_amc" ADD CONSTRAINT "inventory_amc_vendor_id_inventory_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."inventory_vendors"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "inventory_amc_branch_idx" ON "inventory_amc" USING btree ("branch_id");
CREATE INDEX IF NOT EXISTS "inventory_amc_fy_idx" ON "inventory_amc" USING btree ("fy_start_year");

-- Records the migration as applied, so drizzle-kit migrate never runs it again.
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '60b8e4f204b0935f284b76c726f34f1430d62c30cceeb718132c80f7744b3230', 1795605240742
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '60b8e4f204b0935f284b76c726f34f1430d62c30cceeb718132c80f7744b3230');

COMMIT;

-- Afterwards this should return 1, 3, 2 and 1:
-- SELECT (SELECT count(*) FROM information_schema.tables WHERE table_name = 'inventory_amc') AS new_table,
--        (SELECT count(*) FROM pg_constraint WHERE conname LIKE 'inventory_amc_%_fk') AS foreign_keys,
--        (SELECT count(*) FROM pg_indexes WHERE indexname IN ('inventory_amc_branch_idx', 'inventory_amc_fy_idx')) AS indexes,
--        (SELECT count(*) FROM drizzle.__drizzle_migrations WHERE hash = '60b8e4f204b0935f284b76c726f34f1430d62c30cceeb718132c80f7744b3230') AS recorded;
