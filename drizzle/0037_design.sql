CREATE TYPE "public"."design_approval_status" AS ENUM('pending', 'approved', 'changes_requested', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."design_cdr_status" AS ENUM('requested', 'approved', 'declined', 'uploaded');--> statement-breakpoint
CREATE TYPE "public"."design_file_purpose" AS ENUM('attachment', 'proof', 'cdr', 'library', 'post_image');--> statement-breakpoint
CREATE TYPE "public"."design_holiday_type" AS ENUM('national', 'company', 'optional');--> statement-breakpoint
CREATE TYPE "public"."design_post_status" AS ENUM('planned', 'posted');--> statement-breakpoint
CREATE TYPE "public"."design_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."design_ticket_status" AS ENUM('pending_review', 'new', 'assigned', 'in_progress', 'waiting_on_requester', 'in_review', 'delivered', 'closed', 'closed_without_approval', 'superseded', 'declined');--> statement-breakpoint
CREATE TABLE "design_approval_requests" (
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
--> statement-breakpoint
CREATE TABLE "design_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"user_id" uuid,
	"actor_label" text,
	"action" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT '#003F8A' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_cdr_downloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cdr_request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"downloaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_cdr_requests" (
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
--> statement-breakpoint
CREATE TABLE "design_types" (
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
--> statement-breakpoint
CREATE TABLE "design_files" (
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
--> statement-breakpoint
CREATE TABLE "design_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"type" "design_holiday_type" DEFAULT 'national' NOT NULL,
	CONSTRAINT "design_holidays_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE "design_leaves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_library_items" (
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
--> statement-breakpoint
CREATE TABLE "design_library_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"file_id" uuid NOT NULL,
	"note" text,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_pinpoints" (
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
--> statement-breakpoint
CREATE TABLE "design_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"daily_capacity_hours" real DEFAULT 8 NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_proof_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"file_id" uuid NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"edit_window_hours" integer DEFAULT 48 NOT NULL,
	"max_free_revisions" integer DEFAULT 2 NOT NULL,
	"ticket_number_floor" integer DEFAULT 0 NOT NULL,
	"slack_webhook" text,
	"slack_events" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_tick_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_social_posts" (
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
--> statement-breakpoint
CREATE TABLE "design_subtasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"title" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_tickets" (
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
--> statement-breakpoint
CREATE TABLE "design_time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"seconds" integer DEFAULT 0 NOT NULL,
	"note" text,
	"source" text DEFAULT 'timer' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_working_schedule" (
	"day_of_week" smallint PRIMARY KEY NOT NULL,
	"is_working" boolean DEFAULT true NOT NULL,
	"start_hour" smallint DEFAULT 10 NOT NULL,
	"end_hour" smallint DEFAULT 19 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "design_approval_ticket_idx" ON "design_approval_requests" USING btree ("ticket_id","status");--> statement-breakpoint
CREATE INDEX "design_attachments_ticket_idx" ON "design_attachments" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "design_audit_ticket_idx" ON "design_audit_logs" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "design_audit_created_idx" ON "design_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "design_cdr_ticket_idx" ON "design_cdr_requests" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "design_files_unattached_idx" ON "design_files" USING btree ("attached","created_at");--> statement-breakpoint
CREATE INDEX "design_leaves_user_idx" ON "design_leaves" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "design_library_items_folder_idx" ON "design_library_items" USING btree ("folder_id");--> statement-breakpoint
CREATE UNIQUE INDEX "design_library_item_version_uq" ON "design_library_versions" USING btree ("item_id","version");--> statement-breakpoint
CREATE INDEX "design_pinpoints_ticket_idx" ON "design_pinpoints" USING btree ("ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "design_proof_ticket_version_uq" ON "design_proof_versions" USING btree ("ticket_id","version");--> statement-breakpoint
CREATE INDEX "design_saved_views_user_idx" ON "design_saved_views" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "design_social_posts_campaign_idx" ON "design_social_posts" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "design_social_posts_date_idx" ON "design_social_posts" USING btree ("post_date");--> statement-breakpoint
CREATE INDEX "design_subtasks_ticket_idx" ON "design_subtasks" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "design_tickets_status_idx" ON "design_tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "design_tickets_assignee_idx" ON "design_tickets" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "design_tickets_requester_idx" ON "design_tickets" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "design_tickets_parent_idx" ON "design_tickets" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "design_tickets_due_idx" ON "design_tickets" USING btree ("due_at");--> statement-breakpoint
CREATE INDEX "design_time_ticket_idx" ON "design_time_entries" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "design_time_user_idx" ON "design_time_entries" USING btree ("user_id","started_at");