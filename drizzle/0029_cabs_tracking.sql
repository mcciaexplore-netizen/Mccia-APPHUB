CREATE TABLE "cab_driver_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"latitude" numeric(10, 7) NOT NULL,
	"longitude" numeric(10, 7) NOT NULL,
	"accuracy" real,
	"heading" real,
	"speed" real,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ride_id" uuid
);
--> statement-breakpoint
CREATE TABLE "cab_ride_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"otp" char(4) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cab_ride_otps_ride_id_unique" UNIQUE("ride_id")
);
--> statement-breakpoint
ALTER TABLE "cab_rides" ADD COLUMN "pickup_lat" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "cab_rides" ADD COLUMN "pickup_lng" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "cab_rides" ADD COLUMN "dropoff_lat" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "cab_rides" ADD COLUMN "dropoff_lng" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "cab_rides" ADD COLUMN "otp_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cab_driver_locations" ADD CONSTRAINT "cab_driver_locations_driver_id_cab_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."cab_drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cab_driver_locations" ADD CONSTRAINT "cab_driver_locations_ride_id_cab_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."cab_rides"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cab_ride_otps" ADD CONSTRAINT "cab_ride_otps_ride_id_cab_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."cab_rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cab_driver_locations_driver_idx" ON "cab_driver_locations" USING btree ("driver_id","recorded_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cab_driver_locations_ride_idx" ON "cab_driver_locations" USING btree ("ride_id");--> statement-breakpoint
CREATE INDEX "cab_driver_locations_recorded_idx" ON "cab_driver_locations" USING btree ("recorded_at" DESC NULLS LAST);