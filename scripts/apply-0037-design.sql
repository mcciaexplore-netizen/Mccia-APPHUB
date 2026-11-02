-- Applies migration 0037 (DesignDesk: the design team's request and workflow system) to the live database, by hand. Paste the whole file
-- into the SQL Editor of the database production uses (check DB_DRIVER in Vercel: "pg" means Supabase, otherwise Neon; and use the
-- database DATABASE_URL points to) and run it BEFORE this code is deployed. It does not depend on any earlier script beyond the hub's own
-- tables.
--
-- Safe to run more than once, and it changes no existing row:
--   - only NEW tables and types, every one prefixed design_ (23 tables, 7 types). No hub table is touched.
--   - the twelve kinds of design the request form offers (Flyer, WhatsApp creative ...), the working week (Monday to Friday, 10:00 to
--     19:00 IST) and the settings row; anything already there is left as it is.
--   - everything is in one transaction.
--   - the code running in production today never reads these tables, so it keeps working, and so does Instant Rollback.
--   - DesignDesk stays switched off until DESIGN_ENABLED=true is set in Vercel, so the tables can exist before anyone uses them.
--
-- Files are NOT stored in the database: they go to the private Supabase Storage bucket "design-files" (create it in Supabase → Storage,
-- with "Public bucket" OFF), with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set in Vercel.
--
-- To undo it (throws away every DesignDesk ticket, file record, library item, campaign and setting; the files in the bucket stay until you
-- empty it):
--   DROP TABLE IF EXISTS design_approval_requests, design_attachments, design_audit_logs, design_campaigns, design_cdr_downloads, design_cdr_requests, design_files, design_folders, design_holidays, design_leaves, design_library_items, design_library_versions, design_pinpoints, design_profiles, design_proof_versions, design_saved_views, design_settings, design_social_posts, design_subtasks, design_tickets, design_time_entries, design_types, design_working_schedule CASCADE;
--   DROP TYPE IF EXISTS design_approval_status, design_cdr_status, design_file_purpose, design_holiday_type, design_post_status, design_priority, design_ticket_status;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = 'e439efd516990376ff822f0677e7f74577a5c22d779739bb6a72b0ccfe136a84';

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'design_approval_status') THEN
    CREATE TYPE "public"."design_approval_status" AS ENUM('pending', 'approved', 'changes_requested', 'revoked', 'expired');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'design_cdr_status') THEN
    CREATE TYPE "public"."design_cdr_status" AS ENUM('requested', 'approved', 'declined', 'uploaded');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'design_file_purpose') THEN
    CREATE TYPE "public"."design_file_purpose" AS ENUM('attachment', 'proof', 'cdr', 'library', 'post_image');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'design_holiday_type') THEN
    CREATE TYPE "public"."design_holiday_type" AS ENUM('national', 'company', 'optional');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'design_post_status') THEN
    CREATE TYPE "public"."design_post_status" AS ENUM('planned', 'posted');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'design_priority') THEN
    CREATE TYPE "public"."design_priority" AS ENUM('low', 'normal', 'high', 'urgent');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'design_ticket_status') THEN
    CREATE TYPE "public"."design_ticket_status" AS ENUM('pending_review', 'new', 'assigned', 'in_progress', 'waiting_on_requester', 'in_review', 'delivered', 'closed', 'closed_without_approval', 'superseded', 'declined');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "design_approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"proof_version_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"recipient_email" text,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "design_approval_status" DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_name" text,
	"decision_comment" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_approval_requests_token_hash_unique" UNIQUE("token_hash")
);

CREATE TABLE IF NOT EXISTS "design_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "design_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"user_id" uuid,
	"actor_label" text,
	"action" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "design_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT '#003F8A' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "design_cdr_downloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cdr_request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"downloaded_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "design_cdr_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"status" "design_cdr_status" DEFAULT 'requested' NOT NULL,
	"requester_id" uuid NOT NULL,
	"approver_id" uuid,
	"file_id" uuid,
	"uploaded_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "design_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"sla_hours" integer DEFAULT 48 NOT NULL,
	"effort_hours" real DEFAULT 4 NOT NULL,
	"edit_window_hours" integer,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_types_key_unique" UNIQUE("key")
);

CREATE TABLE IF NOT EXISTS "design_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"purpose" "design_file_purpose" NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"attached" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_files_storage_key_unique" UNIQUE("storage_key")
);

CREATE TABLE IF NOT EXISTS "design_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "design_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"type" "design_holiday_type" DEFAULT 'national' NOT NULL,
	CONSTRAINT "design_holidays_date_unique" UNIQUE("date")
);

CREATE TABLE IF NOT EXISTS "design_leaves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "design_library_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"folder_id" uuid NOT NULL,
	"name" text NOT NULL,
	"ticket_id" uuid,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_approved_final" boolean DEFAULT false NOT NULL,
	"expiry_date" date,
	"usage_rights_note" text,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "design_library_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"file_id" uuid NOT NULL,
	"note" text,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "design_pinpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"proof_version_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"x_pct" real NOT NULL,
	"y_pct" real NOT NULL,
	"content" text NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "design_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"daily_capacity_hours" real DEFAULT 8 NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "design_proof_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"file_id" uuid NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "design_saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "design_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"edit_window_hours" integer DEFAULT 48 NOT NULL,
	"max_free_revisions" integer DEFAULT 2 NOT NULL,
	"ticket_number_floor" integer DEFAULT 0 NOT NULL,
	"slack_webhook" text,
	"slack_events" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_tick_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "design_social_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid,
	"platform" text NOT NULL,
	"title" text NOT NULL,
	"post_url" text,
	"post_date" date NOT NULL,
	"status" "design_post_status" DEFAULT 'posted' NOT NULL,
	"notes" text,
	"image_file_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "design_subtasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"title" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "design_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"brief" text NOT NULL,
	"design_type_id" uuid NOT NULL,
	"requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"event_name" text,
	"event_date" date,
	"delivery_date" date,
	"department" text,
	"reference_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"client_changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"priority" "design_priority" DEFAULT 'normal' NOT NULL,
	"status" "design_ticket_status" DEFAULT 'pending_review' NOT NULL,
	"requester_id" uuid NOT NULL,
	"assignee_id" uuid,
	"figma_url" text,
	"due_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"paused_seconds" integer DEFAULT 0 NOT NULL,
	"is_overdue" boolean DEFAULT false NOT NULL,
	"delivered_at" timestamp with time zone,
	"edit_window_ends_at" timestamp with time zone,
	"is_locked" boolean DEFAULT false NOT NULL,
	"parent_id" uuid,
	"version_number" integer DEFAULT 1 NOT NULL,
	"reason_for_change" text,
	"decline_reason" text,
	"estimate_hours" real,
	"time_spent_seconds" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_tickets_number_unique" UNIQUE("number")
);

CREATE TABLE IF NOT EXISTS "design_time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"seconds" integer DEFAULT 0 NOT NULL,
	"note" text,
	"source" text DEFAULT 'timer' NOT NULL
);

CREATE TABLE IF NOT EXISTS "design_working_schedule" (
	"day_of_week" smallint PRIMARY KEY NOT NULL,
	"is_working" boolean DEFAULT true NOT NULL,
	"start_hour" smallint DEFAULT 10 NOT NULL,
	"end_hour" smallint DEFAULT 19 NOT NULL
);

CREATE INDEX IF NOT EXISTS "design_approval_ticket_idx" ON "design_approval_requests" USING btree ("ticket_id","status");

CREATE INDEX IF NOT EXISTS "design_attachments_ticket_idx" ON "design_attachments" USING btree ("ticket_id");

CREATE INDEX IF NOT EXISTS "design_audit_ticket_idx" ON "design_audit_logs" USING btree ("ticket_id","created_at");

CREATE INDEX IF NOT EXISTS "design_audit_created_idx" ON "design_audit_logs" USING btree ("created_at");

CREATE INDEX IF NOT EXISTS "design_cdr_ticket_idx" ON "design_cdr_requests" USING btree ("ticket_id");

CREATE INDEX IF NOT EXISTS "design_files_unattached_idx" ON "design_files" USING btree ("attached","created_at");

CREATE INDEX IF NOT EXISTS "design_leaves_user_idx" ON "design_leaves" USING btree ("user_id");

CREATE INDEX IF NOT EXISTS "design_library_items_folder_idx" ON "design_library_items" USING btree ("folder_id");

CREATE UNIQUE INDEX IF NOT EXISTS "design_library_item_version_uq" ON "design_library_versions" USING btree ("item_id","version");

CREATE INDEX IF NOT EXISTS "design_pinpoints_ticket_idx" ON "design_pinpoints" USING btree ("ticket_id");

CREATE UNIQUE INDEX IF NOT EXISTS "design_proof_ticket_version_uq" ON "design_proof_versions" USING btree ("ticket_id","version");

CREATE INDEX IF NOT EXISTS "design_saved_views_user_idx" ON "design_saved_views" USING btree ("user_id");

CREATE INDEX IF NOT EXISTS "design_social_posts_campaign_idx" ON "design_social_posts" USING btree ("campaign_id");

CREATE INDEX IF NOT EXISTS "design_social_posts_date_idx" ON "design_social_posts" USING btree ("post_date");

CREATE INDEX IF NOT EXISTS "design_subtasks_ticket_idx" ON "design_subtasks" USING btree ("ticket_id");

CREATE INDEX IF NOT EXISTS "design_tickets_status_idx" ON "design_tickets" USING btree ("status");

CREATE INDEX IF NOT EXISTS "design_tickets_assignee_idx" ON "design_tickets" USING btree ("assignee_id");

CREATE INDEX IF NOT EXISTS "design_tickets_requester_idx" ON "design_tickets" USING btree ("requester_id");

CREATE INDEX IF NOT EXISTS "design_tickets_parent_idx" ON "design_tickets" USING btree ("parent_id");

CREATE INDEX IF NOT EXISTS "design_tickets_due_idx" ON "design_tickets" USING btree ("due_at");

CREATE INDEX IF NOT EXISTS "design_time_ticket_idx" ON "design_time_entries" USING btree ("ticket_id");

CREATE INDEX IF NOT EXISTS "design_time_user_idx" ON "design_time_entries" USING btree ("user_id","started_at");

-- The twelve kinds of design on the request form, with their turnaround (hours), typical effort (hours) and questions.
INSERT INTO "design_types" ("key", "name", "sla_hours", "effort_hours", "questions", "sort_order") VALUES
  ('flyer', 'Flyer', 24, 3, '[{"id": "size", "label": "Size", "type": "select", "options": ["A4", "A5", "Square", "Custom"], "required": true}, {"id": "custom_size", "label": "Custom size (if Custom)", "type": "text"}, {"id": "channel", "label": "Print or email?", "type": "select", "options": ["Email", "Print"], "required": true}, {"id": "language", "label": "Language", "type": "select", "options": ["English", "Hindi", "Marathi"]}]'::jsonb, 10),
  ('whatsapp', 'WhatsApp creative', 24, 2, '[{"id": "message", "label": "Message or call-to-action to show on it", "type": "text"}, {"id": "language", "label": "Language", "type": "select", "options": ["English", "Hindi", "Marathi"]}]'::jsonb, 20),
  ('instagram', 'Instagram post', 48, 3, '[{"id": "slides", "label": "Number of slides (for a carousel)", "type": "number"}, {"id": "tag", "label": "Account or people to tag", "type": "text"}, {"id": "language", "label": "Language", "type": "select", "options": ["English", "Hindi", "Marathi"]}]'::jsonb, 30),
  ('linkedin', 'LinkedIn post', 48, 3, '[{"id": "slides", "label": "Number of slides (for a carousel)", "type": "number"}, {"id": "tag", "label": "Page or people to tag", "type": "text"}, {"id": "language", "label": "Language", "type": "select", "options": ["English", "Hindi", "Marathi"]}]'::jsonb, 40),
  ('twitter', 'Twitter / X post', 48, 2, '[{"id": "language", "label": "Language", "type": "select", "options": ["English", "Hindi", "Marathi"]}]'::jsonb, 50),
  ('banner', 'Banner / standee', 24, 4, '[{"id": "size", "label": "Size (width x height)", "type": "text", "required": true}, {"id": "medium", "label": "Print or digital?", "type": "select", "options": ["Print", "Digital"], "required": true}, {"id": "quantity", "label": "Quantity", "type": "number"}, {"id": "language", "label": "Language", "type": "select", "options": ["English", "Hindi", "Marathi"]}]'::jsonb, 60),
  ('backdrop', 'Backdrop / slides', 48, 6, '[{"id": "slides", "label": "Number of slides", "type": "number", "required": true}, {"id": "aspect_ratio", "label": "Aspect ratio", "type": "select", "options": ["16:9", "4:3"], "required": true}, {"id": "language", "label": "Language", "type": "select", "options": ["English", "Hindi", "Marathi"]}]'::jsonb, 70),
  ('book', 'Book', 96, 16, '[{"id": "pages", "label": "Number of pages", "type": "number", "required": true}, {"id": "content_ready", "label": "Is the content ready?", "type": "select", "options": ["Yes, all of it", "Partly", "No"], "required": true}, {"id": "language", "label": "Language", "type": "select", "options": ["English", "Hindi", "Marathi"]}]'::jsonb, 80),
  ('brochure2', '2-page brochure', 72, 8, '[{"id": "copy", "label": "Copy", "type": "select", "options": ["Copy provided", "Needs writing"], "required": true}, {"id": "language", "label": "Language", "type": "select", "options": ["English", "Hindi", "Marathi"]}]'::jsonb, 90),
  ('brochure4', '4-page brochure', 96, 12, '[{"id": "copy", "label": "Copy", "type": "select", "options": ["Copy provided", "Needs writing"], "required": true}, {"id": "language", "label": "Language", "type": "select", "options": ["English", "Hindi", "Marathi"]}]'::jsonb, 100),
  ('media', 'Photo / video / reel', 72, 8, '[{"id": "duration", "label": "Duration (if video or reel)", "type": "text"}, {"id": "platform", "label": "Platform", "type": "text"}, {"id": "shoot", "label": "Shoot date and location", "type": "text"}, {"id": "language", "label": "Language", "type": "select", "options": ["English", "Hindi", "Marathi"]}]'::jsonb, 110),
  ('other', 'Other', 48, 4, '[{"id": "describe", "label": "Describe the design you need", "type": "text", "required": true}, {"id": "language", "label": "Language", "type": "select", "options": ["English", "Hindi", "Marathi"]}]'::jsonb, 120)
ON CONFLICT ("key") DO NOTHING;

-- The working week: Monday (0) to Friday, 10:00 to 19:00 IST; Saturday and Sunday off.
INSERT INTO "design_working_schedule" ("day_of_week", "is_working", "start_hour", "end_hour") VALUES
  (0, true, 10, 19), (1, true, 10, 19), (2, true, 10, 19), (3, true, 10, 19), (4, true, 10, 19), (5, false, 10, 19), (6, false, 10, 19)
ON CONFLICT ("day_of_week") DO NOTHING;

-- The settings row: a 48-hour edit window after delivery, two free revisions, ticket numbers from DF-0001.
INSERT INTO "design_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

-- Migration log entry (hash of drizzle/0037_design.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT 'e439efd516990376ff822f0677e7f74577a5c22d779739bb6a72b0ccfe136a84', 1793618652091
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'e439efd516990376ff822f0677e7f74577a5c22d779739bb6a72b0ccfe136a84');

COMMIT;

-- Afterwards this should return 23, 12 and 7:
-- SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'design\_%') AS design_tables,
--        (SELECT count(*) FROM design_types) AS design_types,
--        (SELECT count(*) FROM design_working_schedule) AS schedule_days;
