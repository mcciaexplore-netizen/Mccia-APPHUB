CREATE TYPE "public"."aistudio_file_purpose" AS ENUM('attachment', 'deliverable');--> statement-breakpoint
CREATE TYPE "public"."aistudio_priority" AS ENUM('urgent', 'high', 'normal', 'low');--> statement-breakpoint
CREATE TYPE "public"."aistudio_request_type" AS ENUM('app_development', 'automation', 'chatbot', 'data_analysis', 'website_tool', 'other');--> statement-breakpoint
CREATE TYPE "public"."aistudio_status" AS ENUM('pending_review', 'accepted', 'in_progress', 'review_testing', 'delivered', 'closed', 'declined');--> statement-breakpoint
CREATE SEQUENCE "public"."aistudio_request_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "aistudio_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aistudio_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" uuid,
	"actor_label" text,
	"action" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aistudio_files" (
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
--> statement-breakpoint
CREATE TABLE "aistudio_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" uuid,
	"body" text NOT NULL,
	"is_internal" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aistudio_requests" (
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
--> statement-breakpoint
CREATE TABLE "aistudio_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"slack_webhook" text,
	"last_tick_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aistudio_attachments" ADD CONSTRAINT "aistudio_attachments_request_id_aistudio_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."aistudio_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aistudio_attachments" ADD CONSTRAINT "aistudio_attachments_file_id_aistudio_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."aistudio_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aistudio_audit_logs" ADD CONSTRAINT "aistudio_audit_logs_request_id_aistudio_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."aistudio_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aistudio_notes" ADD CONSTRAINT "aistudio_notes_request_id_aistudio_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."aistudio_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aistudio_attachments_request_idx" ON "aistudio_attachments" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "aistudio_audit_request_idx" ON "aistudio_audit_logs" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "aistudio_audit_created_idx" ON "aistudio_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "aistudio_files_unattached_idx" ON "aistudio_files" USING btree ("attached","created_at");--> statement-breakpoint
CREATE INDEX "aistudio_notes_request_idx" ON "aistudio_notes" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "aistudio_requests_status_idx" ON "aistudio_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "aistudio_requests_requester_idx" ON "aistudio_requests" USING btree ("requester_id","created_at");--> statement-breakpoint
CREATE INDEX "aistudio_requests_assignee_idx" ON "aistudio_requests" USING btree ("assignee_id");