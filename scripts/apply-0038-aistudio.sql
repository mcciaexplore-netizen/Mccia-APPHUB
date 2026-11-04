-- Applies migration 0038 (AI Studio: staff requests to the AI Studio team) to the live database, by hand. Paste the whole file into the SQL
-- Editor of the database production uses (check DB_DRIVER in Vercel: "pg" means Supabase, otherwise Neon; and use the database
-- DATABASE_URL points to) and run it BEFORE this code is deployed. It does not depend on any earlier script beyond the hub's own tables.
--
-- Safe to run more than once, and it changes no existing row:
--   - only NEW tables, types and a sequence, every one prefixed aistudio_ (6 tables, 4 types, 1 sequence). No hub table is touched.
--   - the settings row (id 1); if it is already there it is left as it is.
--   - everything is in one transaction.
--   - the code running in production today never reads these tables, so it keeps working, and so does Instant Rollback.
--   - AI Studio stays switched off until AISTUDIO_ENABLED=true is set in Vercel, so the tables can exist before anyone uses them.
--
-- Files are NOT stored in the database: they go to the private Supabase Storage bucket "aistudio-files" (create it in Supabase → Storage,
-- with "Public bucket" OFF), with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set in Vercel (already there for DesignDesk).
--
-- To undo it (throws away every AI Studio request, note, file record and setting; the files in the bucket stay until you empty it):
--   DROP TABLE IF EXISTS aistudio_attachments, aistudio_audit_logs, aistudio_files, aistudio_notes, aistudio_requests, aistudio_settings CASCADE;
--   DROP SEQUENCE IF EXISTS aistudio_request_seq;
--   DROP TYPE IF EXISTS aistudio_file_purpose, aistudio_priority, aistudio_request_type, aistudio_status;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = 'a2497e95e4651934c53d8ab698bf3f380fea1662fc7cb51c74fcc930a0093ca6';

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'aistudio_file_purpose') THEN
    CREATE TYPE "public"."aistudio_file_purpose" AS ENUM('attachment', 'deliverable');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'aistudio_priority') THEN
    CREATE TYPE "public"."aistudio_priority" AS ENUM('urgent', 'high', 'normal', 'low');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'aistudio_request_type') THEN
    CREATE TYPE "public"."aistudio_request_type" AS ENUM('app_development', 'automation', 'chatbot', 'data_analysis', 'website_tool', 'other');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'aistudio_status') THEN
    CREATE TYPE "public"."aistudio_status" AS ENUM('pending_review', 'accepted', 'in_progress', 'review_testing', 'delivered', 'closed', 'declined');
  END IF;
END
$$;

CREATE SEQUENCE IF NOT EXISTS "public"."aistudio_request_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;

CREATE TABLE IF NOT EXISTS "aistudio_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "aistudio_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" uuid,
	"actor_label" text,
	"action" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "aistudio_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"purpose" "aistudio_file_purpose" NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"attached" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aistudio_files_storage_key_unique" UNIQUE("storage_key")
);

CREATE TABLE IF NOT EXISTS "aistudio_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" uuid,
	"body" text NOT NULL,
	"is_internal" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "aistudio_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"request_type" "aistudio_request_type" NOT NULL,
	"department" text,
	"status" "aistudio_status" DEFAULT 'pending_review' NOT NULL,
	"priority" "aistudio_priority",
	"deadline" date,
	"requester_id" uuid NOT NULL,
	"assignee_id" uuid,
	"reference_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"content" text,
	"decline_reason" text,
	"delivery_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aistudio_requests_number_unique" UNIQUE("number")
);

CREATE TABLE IF NOT EXISTS "aistudio_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"slack_webhook" text,
	"last_tick_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aistudio_attachments_request_id_aistudio_requests_id_fk') THEN
    ALTER TABLE "aistudio_attachments" ADD CONSTRAINT "aistudio_attachments_request_id_aistudio_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."aistudio_requests"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aistudio_attachments_file_id_aistudio_files_id_fk') THEN
    ALTER TABLE "aistudio_attachments" ADD CONSTRAINT "aistudio_attachments_file_id_aistudio_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."aistudio_files"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aistudio_audit_logs_request_id_aistudio_requests_id_fk') THEN
    ALTER TABLE "aistudio_audit_logs" ADD CONSTRAINT "aistudio_audit_logs_request_id_aistudio_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."aistudio_requests"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aistudio_notes_request_id_aistudio_requests_id_fk') THEN
    ALTER TABLE "aistudio_notes" ADD CONSTRAINT "aistudio_notes_request_id_aistudio_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."aistudio_requests"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "aistudio_attachments_request_idx" ON "aistudio_attachments" USING btree ("request_id");

CREATE INDEX IF NOT EXISTS "aistudio_audit_request_idx" ON "aistudio_audit_logs" USING btree ("request_id","created_at");

CREATE INDEX IF NOT EXISTS "aistudio_audit_created_idx" ON "aistudio_audit_logs" USING btree ("created_at");

CREATE INDEX IF NOT EXISTS "aistudio_files_unattached_idx" ON "aistudio_files" USING btree ("attached","created_at");

CREATE INDEX IF NOT EXISTS "aistudio_notes_request_idx" ON "aistudio_notes" USING btree ("request_id","created_at");

CREATE INDEX IF NOT EXISTS "aistudio_requests_status_idx" ON "aistudio_requests" USING btree ("status","created_at");

CREATE INDEX IF NOT EXISTS "aistudio_requests_requester_idx" ON "aistudio_requests" USING btree ("requester_id","created_at");

CREATE INDEX IF NOT EXISTS "aistudio_requests_assignee_idx" ON "aistudio_requests" USING btree ("assignee_id");

-- The settings row: no Slack webhook yet.
INSERT INTO "aistudio_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

-- Records the migration as applied, so drizzle-kit migrate never runs it again.
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT 'a2497e95e4651934c53d8ab698bf3f380fea1662fc7cb51c74fcc930a0093ca6', 1793776936865
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'a2497e95e4651934c53d8ab698bf3f380fea1662fc7cb51c74fcc930a0093ca6');

COMMIT;

-- Afterwards this should return 6, 4 and 1:
-- SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'aistudio\_%') AS aistudio_tables,
--        (SELECT count(*) FROM pg_type WHERE typname LIKE 'aistudio\_%' AND typtype = 'e') AS aistudio_types,
--        (SELECT count(*) FROM aistudio_settings) AS settings_rows;
