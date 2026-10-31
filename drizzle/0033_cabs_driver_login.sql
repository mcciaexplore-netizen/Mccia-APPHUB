CREATE TABLE "cab_driver_otps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"otp_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"used_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cab_driver_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cab_driver_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "cab_driver_otps" ADD CONSTRAINT "cab_driver_otps_driver_id_cab_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."cab_drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cab_driver_sessions" ADD CONSTRAINT "cab_driver_sessions_driver_id_cab_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."cab_drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cab_driver_otps_driver_idx" ON "cab_driver_otps" USING btree ("driver_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "cab_driver_otps_expires_idx" ON "cab_driver_otps" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "cab_driver_sessions_driver_idx" ON "cab_driver_sessions" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "cab_driver_sessions_expires_idx" ON "cab_driver_sessions" USING btree ("expires_at");