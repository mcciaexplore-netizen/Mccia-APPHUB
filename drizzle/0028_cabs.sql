CREATE TYPE "public"."cab_ride_status" AS ENUM('pending', 'assigned', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "cab_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_name" text NOT NULL,
	"ride_id" uuid,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cab_drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"vehicle_id" uuid,
	"is_available" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cab_drivers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "cab_rides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requested_by_id" uuid NOT NULL,
	"requested_by_name" text NOT NULL,
	"requested_by_email" text NOT NULL,
	"requested_by_branch" text,
	"driver_id" uuid,
	"vehicle_id" uuid,
	"driver_name" text,
	"vehicle_plate" text,
	"pickup" text NOT NULL,
	"dropoff" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"status" "cab_ride_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"assigned_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_name" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cab_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number_plate" text NOT NULL,
	"model" text NOT NULL,
	"capacity" integer DEFAULT 4 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cab_vehicles_number_plate_unique" UNIQUE("number_plate")
);
--> statement-breakpoint
ALTER TABLE "cab_audit_log" ADD CONSTRAINT "cab_audit_log_ride_id_cab_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."cab_rides"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cab_drivers" ADD CONSTRAINT "cab_drivers_vehicle_id_cab_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."cab_vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cab_rides" ADD CONSTRAINT "cab_rides_driver_id_cab_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."cab_drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cab_rides" ADD CONSTRAINT "cab_rides_vehicle_id_cab_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."cab_vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cab_audit_log_created_idx" ON "cab_audit_log" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cab_audit_log_ride_idx" ON "cab_audit_log" USING btree ("ride_id");--> statement-breakpoint
CREATE INDEX "cab_rides_status_idx" ON "cab_rides" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cab_rides_scheduled_idx" ON "cab_rides" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "cab_rides_driver_idx" ON "cab_rides" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "cab_rides_requested_by_idx" ON "cab_rides" USING btree ("requested_by_id");