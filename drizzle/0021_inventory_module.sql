CREATE TYPE "public"."inventory_movement_kind" AS ENUM('inward', 'issue', 'return', 'adjust', 'recount');--> statement-breakpoint
CREATE TYPE "public"."inventory_po_status" AS ENUM('draft', 'sent', 'received', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."inventory_request_status" AS ENUM('pending', 'approved', 'fulfilled', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."inventory_ticket_status" AS ENUM('open', 'in_progress', 'resolved');--> statement-breakpoint
CREATE TABLE "inventory_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE "inventory_user_roles" (
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"granted_by_id" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_user_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_category_id_inventory_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."inventory_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_default_vendor_id_inventory_vendors_id_fk" FOREIGN KEY ("default_vendor_id") REFERENCES "public"."inventory_vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchase_order_lines" ADD CONSTRAINT "inventory_purchase_order_lines_purchase_order_id_inventory_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."inventory_purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchase_order_lines" ADD CONSTRAINT "inventory_purchase_order_lines_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_purchase_orders" ADD CONSTRAINT "inventory_purchase_orders_vendor_id_inventory_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."inventory_vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_requests" ADD CONSTRAINT "inventory_requests_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_movements" ADD CONSTRAINT "inventory_stock_movements_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_stock_movements" ADD CONSTRAINT "inventory_stock_movements_vendor_id_inventory_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."inventory_vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_categories_name_uq" ON "inventory_categories" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_name_uq" ON "inventory_items" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "inventory_items_category_idx" ON "inventory_items" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "inventory_tickets_status_idx" ON "inventory_maintenance_tickets" USING btree ("status","raised_at");--> statement-breakpoint
CREATE INDEX "inventory_po_lines_po_idx" ON "inventory_purchase_order_lines" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE INDEX "inventory_pos_status_idx" ON "inventory_purchase_orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "inventory_requests_status_idx" ON "inventory_requests" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "inventory_requests_requester_idx" ON "inventory_requests" USING btree ("requested_by_user_id","requested_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_item_idx" ON "inventory_stock_movements" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_kind_idx" ON "inventory_stock_movements" USING btree ("kind","created_at");--> statement-breakpoint
CREATE INDEX "inventory_movements_issue_idx" ON "inventory_stock_movements" USING btree ("issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_vendors_name_uq" ON "inventory_vendors" USING btree (lower("name"));