-- Inventory stock per branch. Existing rows are given a branch before the new columns become required: requests the requester's branch
-- (when they have one), everything else one default branch. Here (development and test databases) the default is the oldest active branch,
-- created as "Head Office" only when inventory already has rows and no branch exists. Production is migrated by
-- scripts/apply-0025-inventory-branches.sql instead, where the default branch is named by hand.
ALTER TYPE "public"."inventory_movement_kind" ADD VALUE IF NOT EXISTS 'transfer';--> statement-breakpoint
CREATE TABLE "inventory_branch_stock" (
	"item_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"min_quantity" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "inventory_branch_stock_item_id_branch_id_pk" PRIMARY KEY("item_id","branch_id"),
	CONSTRAINT "inventory_branch_stock_quantity_check" CHECK ("inventory_branch_stock"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_transfers" (
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
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_requests" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_stock_movements" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
DO $$
DECLARE d uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM inventory_items) OR EXISTS (SELECT 1 FROM inventory_requests) OR EXISTS (SELECT 1 FROM inventory_stock_movements) THEN
    SELECT id INTO d FROM branches WHERE is_active ORDER BY created_at, name LIMIT 1;
    IF d IS NULL THEN SELECT id INTO d FROM branches ORDER BY created_at, name LIMIT 1; END IF;
    IF d IS NULL THEN INSERT INTO branches (name) VALUES ('Head Office') RETURNING id INTO d; END IF;
    UPDATE inventory_items SET branch_id = d WHERE branch_id IS NULL;
    UPDATE inventory_stock_movements SET branch_id = d WHERE branch_id IS NULL;
    UPDATE inventory_requests r SET branch_id = coalesce((SELECT u.branch_id FROM users u WHERE u.id = r.requested_by_user_id), d) WHERE r.branch_id IS NULL;
    INSERT INTO inventory_branch_stock (item_id, branch_id, quantity, min_quantity) SELECT id, d, quantity, min_quantity FROM inventory_items ON CONFLICT DO NOTHING;
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "inventory_requests" ALTER COLUMN "branch_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_stock_movements" ALTER COLUMN "branch_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_branch_stock" ADD CONSTRAINT "inventory_branch_stock_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_branch_stock" ADD CONSTRAINT "inventory_branch_stock_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_from_branch_id_branches_id_fk" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_to_branch_id_branches_id_fk" FOREIGN KEY ("to_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_branch_stock_branch_idx" ON "inventory_branch_stock" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "inventory_transfers_created_idx" ON "inventory_transfers" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "inventory_transfers_item_idx" ON "inventory_transfers" USING btree ("item_id");--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_requests" ADD CONSTRAINT "inventory_requests_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_movements" ADD CONSTRAINT "inventory_stock_movements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_requests_branch_idx" ON "inventory_requests" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "inventory_movements_branch_idx" ON "inventory_stock_movements" USING btree ("branch_id","created_at");
