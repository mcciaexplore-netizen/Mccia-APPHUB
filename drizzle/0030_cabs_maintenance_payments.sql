CREATE TABLE "cab_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_number" text NOT NULL,
	"branch" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"total_rides" integer DEFAULT 0 NOT NULL,
	"total_amount_paise" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_by_id" uuid NOT NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "cab_invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "cab_maintenance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"vehicle_plate" text NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"cost_paise" integer,
	"done_at" timestamp with time zone NOT NULL,
	"done_by" text NOT NULL,
	"next_due_at" timestamp with time zone,
	"notes" text,
	"recorded_by_id" uuid NOT NULL,
	"recorded_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cab_ride_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"base_fare_paise" integer DEFAULT 0 NOT NULL,
	"distance_km" numeric(8, 2),
	"notes" text,
	"recorded_by_id" uuid NOT NULL,
	"recorded_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invoice_id" uuid,
	CONSTRAINT "cab_ride_costs_ride_id_unique" UNIQUE("ride_id")
);
--> statement-breakpoint
ALTER TABLE "cab_maintenance" ADD CONSTRAINT "cab_maintenance_vehicle_id_cab_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."cab_vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cab_ride_costs" ADD CONSTRAINT "cab_ride_costs_ride_id_cab_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."cab_rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cab_ride_costs" ADD CONSTRAINT "cab_ride_costs_invoice_id_cab_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."cab_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cab_invoices_status_idx" ON "cab_invoices" USING btree ("status","period_start");--> statement-breakpoint
CREATE INDEX "cab_maintenance_vehicle_idx" ON "cab_maintenance" USING btree ("vehicle_id","done_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cab_maintenance_done_idx" ON "cab_maintenance" USING btree ("done_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cab_ride_costs_invoice_idx" ON "cab_ride_costs" USING btree ("invoice_id");