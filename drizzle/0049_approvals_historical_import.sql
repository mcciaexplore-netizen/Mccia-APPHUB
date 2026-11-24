ALTER TYPE "public"."apr_request_status" ADD VALUE 'historical';--> statement-breakpoint
CREATE TABLE "apr_historical_records" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"batch_id" uuid NOT NULL,
	"source_system" text NOT NULL,
	"legacy_id" text NOT NULL,
	"source_status" text NOT NULL,
	"requester" jsonb NOT NULL,
	"category" jsonb NOT NULL,
	"source_dates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"timeline" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text[] DEFAULT '{}'::text[] NOT NULL,
	"extra" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_record" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apr_historical_records_source_legacy_uq" UNIQUE("source_system","legacy_id")
);
--> statement-breakpoint
CREATE TABLE "apr_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_key" text NOT NULL,
	"source_system" text NOT NULL,
	"file_name" text NOT NULL,
	"file_sha256" text NOT NULL,
	"record_count" integer NOT NULL,
	"raw" jsonb NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"imported_by_id" uuid,
	"imported_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by_name" text
);
--> statement-breakpoint
ALTER TABLE "apr_historical_records" ADD CONSTRAINT "apr_historical_records_request_id_apr_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."apr_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apr_historical_records" ADD CONSTRAINT "apr_historical_records_batch_id_apr_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."apr_import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apr_historical_records_batch_idx" ON "apr_historical_records" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "apr_import_batches_created_idx" ON "apr_import_batches" USING btree ("created_at");