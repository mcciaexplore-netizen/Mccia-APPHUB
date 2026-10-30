ALTER TABLE "cab_rides" ADD COLUMN "trip_type" text DEFAULT 'scheduled' NOT NULL;--> statement-breakpoint
ALTER TABLE "cab_rides" ADD COLUMN "ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cab_rides" ADD COLUMN "stops" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "cab_rides" ADD COLUMN "passengers" integer DEFAULT 1 NOT NULL;