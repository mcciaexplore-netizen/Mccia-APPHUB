CREATE TABLE "cab_fuel_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"vehicle_plate" text NOT NULL,
	"litres" numeric(8, 2) NOT NULL,
	"cost_paise" integer NOT NULL,
	"fuelled_at" timestamp with time zone NOT NULL,
	"station_name" text,
	"recorded_by_id" uuid NOT NULL,
	"recorded_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cab_drivers" ADD COLUMN "login_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cab_fuel_costs" ADD CONSTRAINT "cab_fuel_costs_vehicle_id_cab_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."cab_vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cab_fuel_costs_vehicle_idx" ON "cab_fuel_costs" USING btree ("vehicle_id","fuelled_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cab_fuel_costs_fuelled_idx" ON "cab_fuel_costs" USING btree ("fuelled_at" DESC NULLS LAST);