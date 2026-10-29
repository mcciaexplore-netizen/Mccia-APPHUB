-- Applies migration 0021 (the Inventory module: 4 types and 9 tables, all named inventory_) to the live database, by hand.
-- Paste the whole file into the Neon SQL Editor (project APPHUB, PRODUCTION branch) and run it BEFORE the Inventory code is deployed.
--
-- Additive only, and safe to run more than once:
--   - it only CREATES things whose names start with inventory_. No existing table, column, type, index or row is changed or read.
--   - everything is created together in one transaction, and only if the inventory_movement_kind type is not there yet. Run twice, the
--     second run changes nothing (apart from finding the migration log entry already present).
--   - the code running in production today never mentions these tables, so it keeps working unchanged after this runs.
--   - the migration log entry is added only if it is not there yet.
--
-- To undo it before any Inventory data exists (nothing else depends on these tables):
--   DROP TABLE inventory_purchase_order_lines, inventory_stock_movements, inventory_requests, inventory_purchase_orders,
--     inventory_items, inventory_maintenance_tickets, inventory_categories, inventory_vendors, inventory_user_roles;
--   DROP TYPE inventory_movement_kind, inventory_po_status, inventory_request_status, inventory_ticket_status;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = 'b1ba1b860ecc42609d43b2624bbe39594808bb8c976cf8545215f59b143cd234';

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_movement_kind') THEN
    CREATE TYPE "public"."inventory_movement_kind" AS ENUM('inward', 'issue', 'return', 'adjust', 'recount');
    CREATE TYPE "public"."inventory_po_status" AS ENUM('draft', 'sent', 'received', 'cancelled');
    CREATE TYPE "public"."inventory_request_status" AS ENUM('pending', 'approved', 'fulfilled', 'rejected', 'cancelled');
    CREATE TYPE "public"."inventory_ticket_status" AS ENUM('open', 'in_progress', 'resolved');
    CREATE TABLE "inventory_categories" (
    	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    	"name" text NOT NULL,
    	"active" boolean DEFAULT true NOT NULL,
    	"created_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE TABLE "inventory_items" (
    	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    	"name" text NOT NULL,
    	"category_id" uuid,
    	"unit" text DEFAULT 'Nos' NOT NULL,
    	"quantity" integer DEFAULT 0 NOT NULL,
    	"min_quantity" integer DEFAULT 0 NOT NULL,
    	"rate_paise" bigint,
    	"location" text,
    	"default_vendor_id" uuid,
    	"notes" text,
    	"active" boolean DEFAULT true NOT NULL,
    	"created_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE TABLE "inventory_maintenance_tickets" (
    	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    	"title" text NOT NULL,
    	"note" text,
    	"location" text,
    	"photo_url" text,
    	"status" "inventory_ticket_status" DEFAULT 'open' NOT NULL,
    	"raised_by_user_id" uuid NOT NULL,
    	"raised_by_name" text NOT NULL,
    	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
    	"resolved_by_user_id" uuid,
    	"resolved_by_name" text,
    	"resolved_at" timestamp with time zone,
    	"resolution_note" text,
    	"resolution_photo_url" text
    );
    CREATE TABLE "inventory_purchase_order_lines" (
    	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    	"purchase_order_id" uuid NOT NULL,
    	"item_id" uuid,
    	"description" text NOT NULL,
    	"quantity" integer NOT NULL,
    	"rate_paise" bigint NOT NULL,
    	"received_quantity" integer DEFAULT 0 NOT NULL,
    	"sort" integer DEFAULT 0 NOT NULL
    );
    CREATE TABLE "inventory_purchase_orders" (
    	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    	"po_no" text,
    	"vendor_id" uuid,
    	"vendor_name" text NOT NULL,
    	"vendor_email" text,
    	"notes" text,
    	"status" "inventory_po_status" DEFAULT 'draft' NOT NULL,
    	"created_by_user_id" uuid NOT NULL,
    	"created_by_name" text NOT NULL,
    	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
    	"sent_at" timestamp with time zone,
    	"received_at" timestamp with time zone,
    	CONSTRAINT "inventory_purchase_orders_po_no_unique" UNIQUE("po_no")
    );
    CREATE TABLE "inventory_requests" (
    	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    	"item_id" uuid NOT NULL,
    	"quantity" integer NOT NULL,
    	"note" text,
    	"status" "inventory_request_status" DEFAULT 'pending' NOT NULL,
    	"requested_by_user_id" uuid NOT NULL,
    	"requested_by_name" text NOT NULL,
    	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
    	"resolved_by_user_id" uuid,
    	"resolved_by_name" text,
    	"resolved_at" timestamp with time zone,
    	"reject_reason" text,
    	"fulfilled_movement_id" uuid
    );
    CREATE TABLE "inventory_stock_movements" (
    	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    	"item_id" uuid NOT NULL,
    	"kind" "inventory_movement_kind" NOT NULL,
    	"delta" integer NOT NULL,
    	"quantity_after" integer NOT NULL,
    	"reason" text,
    	"issued_to_user_id" uuid,
    	"issued_to_name" text,
    	"issued_to_department_id" uuid,
    	"event_name" text,
    	"issue_id" uuid,
    	"consumed" boolean DEFAULT false NOT NULL,
    	"vendor_id" uuid,
    	"purchase_order_id" uuid,
    	"challan_no" text,
    	"rate_paise" bigint,
    	"request_id" uuid,
    	"actor_user_id" uuid NOT NULL,
    	"actor_name" text NOT NULL,
    	"created_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE TABLE "inventory_user_roles" (
    	"user_id" uuid NOT NULL,
    	"role" text NOT NULL,
    	"granted_by_id" uuid,
    	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
    	CONSTRAINT "inventory_user_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
    );
    CREATE TABLE "inventory_vendors" (
    	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    	"name" text NOT NULL,
    	"email" text,
    	"phone" text,
    	"address" text,
    	"gstin" text,
    	"pan" text,
    	"active" boolean DEFAULT true NOT NULL,
    	"created_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_category_id_inventory_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."inventory_categories"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_default_vendor_id_inventory_vendors_id_fk" FOREIGN KEY ("default_vendor_id") REFERENCES "public"."inventory_vendors"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "inventory_purchase_order_lines" ADD CONSTRAINT "inventory_purchase_order_lines_purchase_order_id_inventory_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."inventory_purchase_orders"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "inventory_purchase_order_lines" ADD CONSTRAINT "inventory_purchase_order_lines_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "inventory_purchase_orders" ADD CONSTRAINT "inventory_purchase_orders_vendor_id_inventory_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."inventory_vendors"("id") ON DELETE set null ON UPDATE no action;
    ALTER TABLE "inventory_requests" ADD CONSTRAINT "inventory_requests_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;
    ALTER TABLE "inventory_stock_movements" ADD CONSTRAINT "inventory_stock_movements_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;
    ALTER TABLE "inventory_stock_movements" ADD CONSTRAINT "inventory_stock_movements_vendor_id_inventory_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."inventory_vendors"("id") ON DELETE set null ON UPDATE no action;
    CREATE UNIQUE INDEX "inventory_categories_name_uq" ON "inventory_categories" USING btree (lower("name"));
    CREATE UNIQUE INDEX "inventory_items_name_uq" ON "inventory_items" USING btree (lower("name"));
    CREATE INDEX "inventory_items_category_idx" ON "inventory_items" USING btree ("category_id");
    CREATE INDEX "inventory_tickets_status_idx" ON "inventory_maintenance_tickets" USING btree ("status","raised_at");
    CREATE INDEX "inventory_po_lines_po_idx" ON "inventory_purchase_order_lines" USING btree ("purchase_order_id");
    CREATE INDEX "inventory_pos_status_idx" ON "inventory_purchase_orders" USING btree ("status","created_at");
    CREATE INDEX "inventory_requests_status_idx" ON "inventory_requests" USING btree ("status","requested_at");
    CREATE INDEX "inventory_requests_requester_idx" ON "inventory_requests" USING btree ("requested_by_user_id","requested_at");
    CREATE INDEX "inventory_movements_item_idx" ON "inventory_stock_movements" USING btree ("item_id","created_at");
    CREATE INDEX "inventory_movements_kind_idx" ON "inventory_stock_movements" USING btree ("kind","created_at");
    CREATE INDEX "inventory_movements_issue_idx" ON "inventory_stock_movements" USING btree ("issue_id");
    CREATE UNIQUE INDEX "inventory_vendors_name_uq" ON "inventory_vendors" USING btree (lower("name"));
  END IF;
END
$$;

-- Migration log entry (hash of drizzle/0021_inventory_module.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT 'b1ba1b860ecc42609d43b2624bbe39594808bb8c976cf8545215f59b143cd234', 1793265850722
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'b1ba1b860ecc42609d43b2624bbe39594808bb8c976cf8545215f59b143cd234');

COMMIT;

-- Afterwards this should list the 9 tables:
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'inventory\_%' ORDER BY table_name;
