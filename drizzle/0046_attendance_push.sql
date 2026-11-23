CREATE TABLE "att_push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text DEFAULT '' NOT NULL,
	"auth" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "att_push_endpoint_uq" ON "att_push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "att_push_user_idx" ON "att_push_subscriptions" USING btree ("user_id");