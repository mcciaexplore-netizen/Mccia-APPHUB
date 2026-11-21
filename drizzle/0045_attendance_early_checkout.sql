CREATE TABLE "att_early_departures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reason" text NOT NULL,
	"status" "att_request_status" DEFAULT 'pending' NOT NULL,
	"approver_id" uuid,
	"decided_by" uuid,
	"approved_at" timestamp with time zone,
	"approver_remark" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "att_early_live_uq" ON "att_early_departures" USING btree ("user_id","date") WHERE status in ('pending', 'approved');--> statement-breakpoint
CREATE INDEX "att_early_status_idx" ON "att_early_departures" USING btree ("status","approver_id");