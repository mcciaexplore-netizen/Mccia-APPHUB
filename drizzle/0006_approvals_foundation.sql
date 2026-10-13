CREATE TYPE "public"."apr_attachment_slot" AS ENUM('file_upload', 'file_upload_2', 'tax_invoice', 'quotation', 'supporting');--> statement-breakpoint
CREATE TYPE "public"."apr_event_action" AS ENUM('submitted', 'assigned', 'approved', 'rejected', 'withdrawn', 'resubmitted', 'reassigned', 'comment');--> statement-breakpoint
CREATE TYPE "public"."apr_request_status" AS ENUM('draft', 'pending', 'approved', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."apr_request_type" AS ENUM('hr', 'expenditure_small', 'expenditure_large');--> statement-breakpoint
CREATE TYPE "public"."apr_step_status" AS ENUM('waiting', 'pending', 'approved', 'rejected', 'skipped');--> statement-breakpoint
CREATE TABLE "apr_admin_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"actor_name" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apr_approval_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"action" "apr_event_action" NOT NULL,
	"step_no" integer,
	"actor_user_id" uuid,
	"actor_name" text NOT NULL,
	"from_status" "apr_request_status",
	"to_status" "apr_request_status",
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apr_approver_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_type" "apr_request_type" NOT NULL,
	"step_no" integer NOT NULL,
	"step_label" text NOT NULL,
	"min_amount_paise" bigint DEFAULT 0 NOT NULL,
	"max_amount_paise" bigint,
	"approver_user_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "apr_approver_rules_type_step_min_uq" UNIQUE("request_type","step_no","min_amount_paise")
);
--> statement-breakpoint
CREATE TABLE "apr_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"slot" "apr_attachment_slot" NOT NULL,
	"file_name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apr_branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apr_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"financial_year" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"allocated_paise" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apr_budgets_fy_branch_category_uq" UNIQUE("financial_year","branch_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "apr_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"duplicate_group" text,
	"merged_into_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apr_counters" (
	"key" text PRIMARY KEY NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apr_expenditure_details" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"category_id" uuid NOT NULL,
	"nature_of_expenditure" text,
	"branch_id" uuid NOT NULL,
	"budget_allocated_paise" bigint,
	"budget_available_paise" bigint,
	"budget_remaining_paise" bigint,
	"difference_paise" bigint,
	"vendor_name" text,
	"tax_invoice_date" date,
	"expense_date" date,
	"publication_type_id" uuid,
	"publication_id" uuid
);
--> statement-breakpoint
CREATE TABLE "apr_hr_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apr_hr_details" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"hr_category_id" uuid NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "apr_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"request_id" uuid,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apr_publication_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apr_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publication_type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apr_rate_limits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"bucket" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apr_request_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"step_no" integer NOT NULL,
	"step_label" text NOT NULL,
	"approver_user_id" uuid NOT NULL,
	"approver_name" text NOT NULL,
	"status" "apr_step_status" DEFAULT 'waiting' NOT NULL,
	"comment" text,
	"assigned_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	CONSTRAINT "apr_request_steps_request_step_uq" UNIQUE("request_id","step_no")
);
--> statement-breakpoint
CREATE TABLE "apr_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_no" text,
	"type" "apr_request_type" NOT NULL,
	"status" "apr_request_status" DEFAULT 'draft' NOT NULL,
	"requester_user_id" uuid NOT NULL,
	"requester_name" text NOT NULL,
	"requester_email" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"financial_year" text,
	"current_step" integer DEFAULT 0 NOT NULL,
	"total_steps" integer DEFAULT 0 NOT NULL,
	"current_approver_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_comment" text,
	"amount_paise" bigint,
	"resubmitted_from_id" uuid,
	"legacy_id" text,
	"reminder_last_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apr_requests_request_no_unique" UNIQUE("request_no"),
	CONSTRAINT "apr_requests_legacy_id_unique" UNIQUE("legacy_id")
);
--> statement-breakpoint
CREATE TABLE "apr_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apr_user_roles" (
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"granted_by_id" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apr_user_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
ALTER TABLE "apr_approval_events" ADD CONSTRAINT "apr_approval_events_request_id_apr_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."apr_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apr_attachments" ADD CONSTRAINT "apr_attachments_request_id_apr_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."apr_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apr_budgets" ADD CONSTRAINT "apr_budgets_branch_id_apr_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."apr_branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apr_budgets" ADD CONSTRAINT "apr_budgets_category_id_apr_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."apr_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apr_expenditure_details" ADD CONSTRAINT "apr_expenditure_details_request_id_apr_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."apr_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apr_expenditure_details" ADD CONSTRAINT "apr_expenditure_details_category_id_apr_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."apr_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apr_expenditure_details" ADD CONSTRAINT "apr_expenditure_details_branch_id_apr_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."apr_branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apr_expenditure_details" ADD CONSTRAINT "apr_expenditure_details_publication_type_id_apr_publication_types_id_fk" FOREIGN KEY ("publication_type_id") REFERENCES "public"."apr_publication_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apr_expenditure_details" ADD CONSTRAINT "apr_expenditure_details_publication_id_apr_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."apr_publications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apr_hr_details" ADD CONSTRAINT "apr_hr_details_request_id_apr_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."apr_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apr_hr_details" ADD CONSTRAINT "apr_hr_details_hr_category_id_apr_hr_categories_id_fk" FOREIGN KEY ("hr_category_id") REFERENCES "public"."apr_hr_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apr_notifications" ADD CONSTRAINT "apr_notifications_request_id_apr_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."apr_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apr_publications" ADD CONSTRAINT "apr_publications_publication_type_id_apr_publication_types_id_fk" FOREIGN KEY ("publication_type_id") REFERENCES "public"."apr_publication_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apr_request_steps" ADD CONSTRAINT "apr_request_steps_request_id_apr_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."apr_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apr_admin_audit_created_idx" ON "apr_admin_audit" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "apr_approval_events_request_idx" ON "apr_approval_events" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "apr_attachments_request_idx" ON "apr_attachments" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "apr_branches_name_uq" ON "apr_branches" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "apr_categories_name_uq" ON "apr_categories" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "apr_hr_categories_name_uq" ON "apr_hr_categories" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "apr_notifications_user_idx" ON "apr_notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "apr_publication_types_name_uq" ON "apr_publication_types" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "apr_publications_name_uq" ON "apr_publications" USING btree ("publication_type_id",lower("name"));--> statement-breakpoint
CREATE INDEX "apr_rate_limits_idx" ON "apr_rate_limits" USING btree ("bucket","user_id","created_at");--> statement-breakpoint
CREATE INDEX "apr_request_steps_approver_idx" ON "apr_request_steps" USING btree ("approver_user_id","status");--> statement-breakpoint
CREATE INDEX "apr_requests_status_idx" ON "apr_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "apr_requests_type_idx" ON "apr_requests" USING btree ("type");--> statement-breakpoint
CREATE INDEX "apr_requests_requester_idx" ON "apr_requests" USING btree ("requester_user_id");--> statement-breakpoint
CREATE INDEX "apr_requests_approver_idx" ON "apr_requests" USING btree ("current_approver_user_id");--> statement-breakpoint
CREATE INDEX "apr_requests_requested_at_idx" ON "apr_requests" USING btree ("requested_at");--> statement-breakpoint
CREATE INDEX "apr_requests_fy_idx" ON "apr_requests" USING btree ("financial_year");