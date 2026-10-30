-- inventory_branch_stock as it is in production: an id primary key, a unique (item_id, branch_id), low_stock_level and created_at, and no
-- min_quantity or quantity check. Production's table already had this shape before 0025 (whose CREATE TABLE IF NOT EXISTS left it alone),
-- so every step here only runs when needed: on production it changes nothing; on a database built by 0025 it reshapes the table.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'inventory_branch_stock' AND column_name = 'id') THEN
    ALTER TABLE "inventory_branch_stock" DROP CONSTRAINT IF EXISTS "inventory_branch_stock_item_id_branch_id_pk";
    ALTER TABLE "inventory_branch_stock" ADD COLUMN "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;
  END IF;
  ALTER TABLE "inventory_branch_stock" DROP CONSTRAINT IF EXISTS "inventory_branch_stock_quantity_check";
  ALTER TABLE "inventory_branch_stock" ADD COLUMN IF NOT EXISTS "low_stock_level" integer DEFAULT 0 NOT NULL;
  ALTER TABLE "inventory_branch_stock" ADD COLUMN IF NOT EXISTS "created_at" timestamp with time zone DEFAULT now() NOT NULL;
  ALTER TABLE "inventory_branch_stock" DROP COLUMN IF EXISTS "min_quantity";
  -- One row per item and branch (what the code's ON CONFLICT (item_id, branch_id) needs), unless a unique constraint on them is already there.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.inventory_branch_stock'::regclass AND contype IN ('u', 'p')
      AND (SELECT array_agg(attname::text ORDER BY attname) FROM pg_attribute WHERE attrelid = conrelid AND attnum = ANY (conkey)) = ARRAY['branch_id', 'item_id']
  ) THEN
    ALTER TABLE "inventory_branch_stock" ADD CONSTRAINT "inventory_branch_stock_item_id_branch_id_unique" UNIQUE("item_id","branch_id");
  END IF;
END
$$;
