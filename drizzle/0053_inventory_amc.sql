CREATE TYPE "public"."inventory_amc_type" AS ENUM('comprehensive', 'non_comprehensive', 'service', 'cec');--> statement-breakpoint
CREATE TABLE "inventory_amc" (
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
--> statement-breakpoint
ALTER TABLE "inventory_amc" ADD CONSTRAINT "inventory_amc_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_amc" ADD CONSTRAINT "inventory_amc_category_id_inventory_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."inventory_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_amc" ADD CONSTRAINT "inventory_amc_vendor_id_inventory_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."inventory_vendors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_amc_branch_idx" ON "inventory_amc" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "inventory_amc_fy_idx" ON "inventory_amc" USING btree ("fy_start_year");