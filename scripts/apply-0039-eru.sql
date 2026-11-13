-- Applies migration 0039 (ERU: the Economic Research Unit's projects and documents) to the live database, by hand. Paste the whole file
-- into the SQL Editor of the database production uses (check DB_DRIVER in Vercel: "pg" means Supabase, otherwise Neon; and use the database
-- DATABASE_URL points to) and run it BEFORE this code is deployed. It does not depend on any earlier script beyond the hub's own tables.
--
-- Safe to run more than once, and it changes no existing row:
--   - only NEW tables, types and a sequence, every one prefixed eru_ (8 tables, 3 types, 1 sequence). No hub table is touched.
--   - the five domains and the settings row (id 1); any already there are left as they are.
--   - everything is in one transaction.
--   - the code running in production today never reads these tables, so it keeps working, and so does Instant Rollback.
--   - ERU stays switched off until ERU_ENABLED=true is set in Vercel, so the tables can exist before anyone uses them.
--
-- Files are NOT stored in the database: they go to the private Supabase Storage bucket "eru-files" (create it in Supabase → Storage, with
-- "Public bucket" OFF), with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set in Vercel (already there for DesignDesk and AI Studio).
--
-- To undo it (throws away every ERU project, document, comment, change record, file record and setting; the files in the bucket stay until
-- you empty it):
--   DROP TABLE IF EXISTS eru_audit_logs, eru_document_changes, eru_document_comments, eru_files, eru_documents, eru_projects, eru_domains, eru_settings CASCADE;
--   DROP SEQUENCE IF EXISTS eru_project_seq;
--   DROP TYPE IF EXISTS eru_change_status, eru_priority, eru_project_status;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = 'cdb8542a3ee0047a80a5e8c280635f8e67fbaa92ae169b7458c852d88aaf033b';

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'eru_change_status') THEN
    CREATE TYPE "public"."eru_change_status" AS ENUM('pending', 'accepted', 'rejected');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'eru_priority') THEN
    CREATE TYPE "public"."eru_priority" AS ENUM('urgent', 'high', 'normal', 'low');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'eru_project_status') THEN
    CREATE TYPE "public"."eru_project_status" AS ENUM('draft', 'active', 'in_review', 'completed', 'archived');
  END IF;
END
$$;

CREATE SEQUENCE IF NOT EXISTS "public"."eru_project_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;

CREATE TABLE IF NOT EXISTS "eru_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"user_id" uuid,
	"action" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "eru_document_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"change_type" text NOT NULL,
	"from_content" text DEFAULT '' NOT NULL,
	"to_content" text DEFAULT '' NOT NULL,
	"selection_from" integer DEFAULT 0 NOT NULL,
	"selection_to" integer DEFAULT 0 NOT NULL,
	"status" "eru_change_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "eru_document_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"selection_from" integer DEFAULT 0 NOT NULL,
	"selection_to" integer DEFAULT 0 NOT NULL,
	"quote" text DEFAULT '' NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "eru_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"original_file_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"track_changes" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"last_edited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "eru_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"color" text DEFAULT 'blue' NOT NULL,
	"icon" text DEFAULT 'folder' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eru_domains_key_unique" UNIQUE("key")
);

CREATE TABLE IF NOT EXISTS "eru_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"document_id" uuid,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"attached" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eru_files_storage_key_unique" UNIQUE("storage_key")
);

CREATE TABLE IF NOT EXISTS "eru_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"domain_id" uuid NOT NULL,
	"status" "eru_project_status" DEFAULT 'active' NOT NULL,
	"priority" "eru_priority" DEFAULT 'normal' NOT NULL,
	"created_by" uuid NOT NULL,
	"assigned_to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"due_date" date,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reference_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eru_projects_number_unique" UNIQUE("number")
);

CREATE TABLE IF NOT EXISTS "eru_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"track_changes_default" boolean DEFAULT false NOT NULL,
	"last_tick_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eru_audit_logs_project_id_eru_projects_id_fk') THEN
    ALTER TABLE "eru_audit_logs" ADD CONSTRAINT "eru_audit_logs_project_id_eru_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."eru_projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eru_document_changes_document_id_eru_documents_id_fk') THEN
    ALTER TABLE "eru_document_changes" ADD CONSTRAINT "eru_document_changes_document_id_eru_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."eru_documents"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eru_document_comments_document_id_eru_documents_id_fk') THEN
    ALTER TABLE "eru_document_comments" ADD CONSTRAINT "eru_document_comments_document_id_eru_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."eru_documents"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eru_documents_project_id_eru_projects_id_fk') THEN
    ALTER TABLE "eru_documents" ADD CONSTRAINT "eru_documents_project_id_eru_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."eru_projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eru_files_project_id_eru_projects_id_fk') THEN
    ALTER TABLE "eru_files" ADD CONSTRAINT "eru_files_project_id_eru_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."eru_projects"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eru_files_document_id_eru_documents_id_fk') THEN
    ALTER TABLE "eru_files" ADD CONSTRAINT "eru_files_document_id_eru_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."eru_documents"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eru_projects_domain_id_eru_domains_id_fk') THEN
    ALTER TABLE "eru_projects" ADD CONSTRAINT "eru_projects_domain_id_eru_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."eru_domains"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "eru_audit_project_idx" ON "eru_audit_logs" USING btree ("project_id","created_at");

CREATE INDEX IF NOT EXISTS "eru_audit_created_idx" ON "eru_audit_logs" USING btree ("created_at");

CREATE INDEX IF NOT EXISTS "eru_changes_document_idx" ON "eru_document_changes" USING btree ("document_id","status");

CREATE INDEX IF NOT EXISTS "eru_changes_status_idx" ON "eru_document_changes" USING btree ("status");

CREATE INDEX IF NOT EXISTS "eru_comments_document_idx" ON "eru_document_comments" USING btree ("document_id","created_at");

CREATE INDEX IF NOT EXISTS "eru_documents_project_idx" ON "eru_documents" USING btree ("project_id","updated_at");

CREATE INDEX IF NOT EXISTS "eru_files_project_idx" ON "eru_files" USING btree ("project_id");

CREATE INDEX IF NOT EXISTS "eru_files_unattached_idx" ON "eru_files" USING btree ("attached","created_at");

CREATE INDEX IF NOT EXISTS "eru_projects_domain_idx" ON "eru_projects" USING btree ("domain_id","updated_at");

CREATE INDEX IF NOT EXISTS "eru_projects_status_idx" ON "eru_projects" USING btree ("status");

CREATE INDEX IF NOT EXISTS "eru_projects_assigned_idx" ON "eru_projects" USING gin ("assigned_to");

-- The five domains (left as they are if already there).
INSERT INTO "eru_domains" ("key", "name", "description", "color", "icon", "sort_order") VALUES
	('policy_research', 'Policy Research & Advocacy', 'Policy analysis, representations and advocacy on economic and industrial policy.', 'blue', 'landmark', 1),
	('primary_service', 'Primary Service', 'Primary research and surveys: data collection, fieldwork and member studies.', 'green', 'clipboard-list', 2),
	('research_papers', 'Research Papers & Publications', 'Research papers, reports, newsletters and other publications.', 'purple', 'book-open', 3),
	('quality_check', 'Quality Check', 'Review and quality checks of drafts and data before release.', 'orange', 'shield-check', 4),
	('internal_support', 'Internal Support', 'Research and data support for other MCCIA departments.', 'gray', 'life-buoy', 5)
ON CONFLICT ("key") DO NOTHING;

-- The settings row.
INSERT INTO "eru_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

-- Records the migration as applied, so drizzle-kit migrate never runs it again.
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT 'cdb8542a3ee0047a80a5e8c280635f8e67fbaa92ae169b7458c852d88aaf033b', 1794566375910
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'cdb8542a3ee0047a80a5e8c280635f8e67fbaa92ae169b7458c852d88aaf033b');

COMMIT;

-- Afterwards this should return 8, 3, 5 and 1:
-- SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'eru\_%') AS eru_tables,
--        (SELECT count(*) FROM pg_type WHERE typname LIKE 'eru\_%' AND typtype = 'e') AS eru_types,
--        (SELECT count(*) FROM eru_domains) AS domains,
--        (SELECT count(*) FROM eru_settings) AS settings_rows;
