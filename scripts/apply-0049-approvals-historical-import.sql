-- Applies migration 0049 (Approval System: historical import of old approval records) to the live database, by hand. Paste the whole file into
-- the SQL Editor of the database production uses (DB_DRIVER "pg" in Vercel = Supabase, otherwise Neon; the database DATABASE_URL points to)
-- and run it BEFORE the code on feat/approvals-historical-import is deployed.
--
-- Safe to run more than once, and it changes no existing row:
--   - the request status list gains one value, "historical" (an archived ticket imported from an older system). No existing request has it,
--     and the code running in production today never writes it, so it keeps working, and so does Instant Rollback.
--   - two NEW tables: apr_import_batches (one row per upload, with the file as uploaded) and apr_historical_records (what each imported
--     ticket keeps from its source: its own ID, status, dates, timeline and the original record). Linked to apr_requests: removing a ticket
--     removes its historical record; an import's row stays.
--   - the tables are in one transaction. The status value is added first, on its own (Postgres adds enum values outside a transaction's reach).
--
-- To undo it (removes every imported ticket first; the "historical" status value itself stays in the list, unused and harmless: Postgres
-- cannot drop an enum value without rebuilding the type):
--   DELETE FROM apr_requests WHERE status = 'historical' AND NOT EXISTS (SELECT 1 FROM apr_approval_events e WHERE e.request_id = apr_requests.id);
--   DROP TABLE IF EXISTS apr_historical_records;
--   DROP TABLE IF EXISTS apr_import_batches;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = 'a504569bca275788f6cf9fabca381a39fb54d2ff0014fa8f3b365d310f952f14';

ALTER TYPE "public"."apr_request_status" ADD VALUE IF NOT EXISTS 'historical';

BEGIN;

CREATE TABLE IF NOT EXISTS "apr_import_batches" (
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

CREATE TABLE IF NOT EXISTS "apr_historical_records" (
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

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apr_historical_records_request_id_apr_requests_id_fk') THEN
    ALTER TABLE "apr_historical_records" ADD CONSTRAINT "apr_historical_records_request_id_apr_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."apr_requests"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apr_historical_records_batch_id_apr_import_batches_id_fk') THEN
    ALTER TABLE "apr_historical_records" ADD CONSTRAINT "apr_historical_records_batch_id_apr_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."apr_import_batches"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "apr_historical_records_batch_idx" ON "apr_historical_records" USING btree ("batch_id");
CREATE INDEX IF NOT EXISTS "apr_import_batches_created_idx" ON "apr_import_batches" USING btree ("created_at");

-- Records the migration as applied, so drizzle-kit migrate never runs it again.
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT 'a504569bca275788f6cf9fabca381a39fb54d2ff0014fa8f3b365d310f952f14', 1795506637077
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'a504569bca275788f6cf9fabca381a39fb54d2ff0014fa8f3b365d310f952f14');

COMMIT;

-- Afterwards this should return 1, 2, 3 and 1:
-- SELECT (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'apr_request_status' AND e.enumlabel = 'historical') AS status_value,
--        (SELECT count(*) FROM information_schema.tables WHERE table_name IN ('apr_import_batches', 'apr_historical_records')) AS new_tables,
--        (SELECT count(*) FROM pg_constraint WHERE conname IN ('apr_historical_records_source_legacy_uq', 'apr_historical_records_request_id_apr_requests_id_fk', 'apr_historical_records_batch_id_apr_import_batches_id_fk')) AS constraints,
--        (SELECT count(*) FROM drizzle.__drizzle_migrations WHERE hash = 'a504569bca275788f6cf9fabca381a39fb54d2ff0014fa8f3b365d310f952f14') AS recorded;
