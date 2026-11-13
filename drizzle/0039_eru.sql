CREATE TYPE "public"."eru_change_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."eru_priority" AS ENUM('urgent', 'high', 'normal', 'low');--> statement-breakpoint
CREATE TYPE "public"."eru_project_status" AS ENUM('draft', 'active', 'in_review', 'completed', 'archived');--> statement-breakpoint
CREATE SEQUENCE "public"."eru_project_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "eru_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"user_id" uuid,
	"action" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eru_document_changes" (
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
--> statement-breakpoint
CREATE TABLE "eru_document_comments" (
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
--> statement-breakpoint
CREATE TABLE "eru_documents" (
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
--> statement-breakpoint
CREATE TABLE "eru_domains" (
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
--> statement-breakpoint
CREATE TABLE "eru_files" (
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
--> statement-breakpoint
CREATE TABLE "eru_projects" (
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
--> statement-breakpoint
CREATE TABLE "eru_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"track_changes_default" boolean DEFAULT false NOT NULL,
	"last_tick_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "eru_audit_logs" ADD CONSTRAINT "eru_audit_logs_project_id_eru_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."eru_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eru_document_changes" ADD CONSTRAINT "eru_document_changes_document_id_eru_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."eru_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eru_document_comments" ADD CONSTRAINT "eru_document_comments_document_id_eru_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."eru_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eru_documents" ADD CONSTRAINT "eru_documents_project_id_eru_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."eru_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eru_files" ADD CONSTRAINT "eru_files_project_id_eru_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."eru_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eru_files" ADD CONSTRAINT "eru_files_document_id_eru_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."eru_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eru_projects" ADD CONSTRAINT "eru_projects_domain_id_eru_domains_id_fk" FOREIGN KEY ("domain_id") REFERENCES "public"."eru_domains"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eru_audit_project_idx" ON "eru_audit_logs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "eru_audit_created_idx" ON "eru_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "eru_changes_document_idx" ON "eru_document_changes" USING btree ("document_id","status");--> statement-breakpoint
CREATE INDEX "eru_changes_status_idx" ON "eru_document_changes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "eru_comments_document_idx" ON "eru_document_comments" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "eru_documents_project_idx" ON "eru_documents" USING btree ("project_id","updated_at");--> statement-breakpoint
CREATE INDEX "eru_files_project_idx" ON "eru_files" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "eru_files_unattached_idx" ON "eru_files" USING btree ("attached","created_at");--> statement-breakpoint
CREATE INDEX "eru_projects_domain_idx" ON "eru_projects" USING btree ("domain_id","updated_at");--> statement-breakpoint
CREATE INDEX "eru_projects_status_idx" ON "eru_projects" USING btree ("status");--> statement-breakpoint
CREATE INDEX "eru_projects_assigned_idx" ON "eru_projects" USING gin ("assigned_to");--> statement-breakpoint
INSERT INTO "eru_domains" ("key", "name", "description", "color", "icon", "sort_order") VALUES
	('policy_research', 'Policy Research & Advocacy', 'Policy analysis, representations and advocacy on economic and industrial policy.', 'blue', 'landmark', 1),
	('primary_service', 'Primary Service', 'Primary research and surveys: data collection, fieldwork and member studies.', 'green', 'clipboard-list', 2),
	('research_papers', 'Research Papers & Publications', 'Research papers, reports, newsletters and other publications.', 'purple', 'book-open', 3),
	('quality_check', 'Quality Check', 'Review and quality checks of drafts and data before release.', 'orange', 'shield-check', 4),
	('internal_support', 'Internal Support', 'Research and data support for other MCCIA departments.', 'gray', 'life-buoy', 5)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "eru_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
