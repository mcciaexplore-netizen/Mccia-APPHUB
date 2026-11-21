CREATE TYPE "public"."att_accrual_type" AS ENUM('full_year', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."att_check_in_method" AS ENUM('gps', 'ip', 'manual', 'wfh');--> statement-breakpoint
CREATE TYPE "public"."att_compoff_status" AS ENUM('pending', 'approved', 'rejected', 'used', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."att_compoff_type" AS ENUM('full', 'half');--> statement-breakpoint
CREATE TYPE "public"."att_day_status" AS ENUM('present', 'absent', 'half_day', 'holiday', 'weekly_off', 'leave', 'wfh');--> statement-breakpoint
CREATE TYPE "public"."att_employment_type" AS ENUM('intern', 'consultant', 'staff');--> statement-breakpoint
CREATE TYPE "public"."att_half_day" AS ENUM('none', 'first', 'second');--> statement-breakpoint
CREATE TYPE "public"."att_missed_punch" AS ENUM('checkin', 'checkout', 'both');--> statement-breakpoint
CREATE TYPE "public"."att_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."att_timesheet_status" AS ENUM('draft', 'submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "att_announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "att_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"shift_id" uuid,
	"check_in_time" timestamp with time zone,
	"check_out_time" timestamp with time zone,
	"check_in_method" "att_check_in_method",
	"check_out_method" "att_check_in_method",
	"check_in_lat" double precision,
	"check_in_lng" double precision,
	"check_in_ip" text,
	"is_late" boolean DEFAULT false NOT NULL,
	"is_early_out" boolean DEFAULT false NOT NULL,
	"is_wfh" boolean DEFAULT false NOT NULL,
	"is_extra_work" boolean DEFAULT false NOT NULL,
	"hours_worked" numeric(6, 2),
	"deficit_hours" numeric(6, 2),
	"excess_hours" numeric(6, 2),
	"regularization_id" uuid,
	"status" "att_day_status" DEFAULT 'present' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "att_compoff_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"worked_date" date NOT NULL,
	"compoff_type" "att_compoff_type" DEFAULT 'full' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"expiry_date" date,
	"status" "att_compoff_status" DEFAULT 'pending' NOT NULL,
	"approver_id" uuid,
	"decided_by" uuid,
	"approved_at" timestamp with time zone,
	"approver_remark" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "att_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"is_optional" boolean DEFAULT false NOT NULL,
	"year" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "att_leave_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"days" numeric(6, 2) NOT NULL,
	"remark" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "att_leave_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"entitled" numeric(6, 2) DEFAULT 0 NOT NULL,
	"carried" numeric(6, 2) DEFAULT 0 NOT NULL,
	"adjusted" numeric(6, 2) DEFAULT 0 NOT NULL,
	"booked" numeric(6, 2) DEFAULT 0 NOT NULL,
	"pending" numeric(6, 2) DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "att_leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"half_day" "att_half_day" DEFAULT 'none' NOT NULL,
	"days_count" numeric(6, 2) NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"attachment_url" text,
	"attachment_name" text,
	"status" "att_request_status" DEFAULT 'pending' NOT NULL,
	"approver_id" uuid,
	"decided_by" uuid,
	"approved_at" timestamp with time zone,
	"approver_remark" text,
	"cc_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "att_leave_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'blue' NOT NULL,
	"days_per_year" numeric(6, 2) DEFAULT 21 NOT NULL,
	"accrual_type" "att_accrual_type" DEFAULT 'full_year' NOT NULL,
	"carry_forward_cap" numeric(6, 2) DEFAULT 0 NOT NULL,
	"max_consecutive_days" integer,
	"notice_period_days" integer DEFAULT 0 NOT NULL,
	"allow_half_day" boolean DEFAULT false NOT NULL,
	"half_day_first" boolean DEFAULT true NOT NULL,
	"half_day_second" boolean DEFAULT true NOT NULL,
	"requires_document_after_days" integer,
	"requires_reason" boolean DEFAULT false NOT NULL,
	"available_to" text DEFAULT 'all' NOT NULL,
	"count_weekends" boolean DEFAULT false NOT NULL,
	"is_compoff" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "att_regularization_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"missed" "att_missed_punch" NOT NULL,
	"requested_checkin" time,
	"requested_checkout" time,
	"reason" text NOT NULL,
	"status" "att_request_status" DEFAULT 'pending' NOT NULL,
	"approver_id" uuid,
	"decided_by" uuid,
	"approved_at" timestamp with time zone,
	"approver_remark" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "att_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "att_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"grace_minutes" integer DEFAULT 45 NOT NULL,
	"full_day_hours" numeric(6, 2) DEFAULT 7.5 NOT NULL,
	"half_day_hours" numeric(6, 2) DEFAULT 4 NOT NULL,
	"first_half_end" time DEFAULT '14:00' NOT NULL,
	"second_half_start" time DEFAULT '14:00' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "att_time_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"date" date NOT NULL,
	"hours" numeric(6, 2) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"week_start_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "att_time_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "att_timesheets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"week_start_date" date NOT NULL,
	"status" "att_timesheet_status" DEFAULT 'draft' NOT NULL,
	"total_hours" numeric(6, 2) DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"approver_id" uuid,
	"decided_by" uuid,
	"approved_at" timestamp with time zone,
	"approver_remark" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "att_user_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"shift_id" uuid,
	"employment_type" "att_employment_type" DEFAULT 'staff' NOT NULL,
	"date_of_joining" date,
	"date_of_birth" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "att_user_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "att_wfh_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reason" text NOT NULL,
	"plan_note" text DEFAULT '' NOT NULL,
	"status" "att_request_status" DEFAULT 'pending' NOT NULL,
	"approver_id" uuid,
	"decided_by" uuid,
	"approved_at" timestamp with time zone,
	"approver_remark" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "att_wishes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_date" date NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "att_leave_adjustments" ADD CONSTRAINT "att_leave_adjustments_leave_type_id_att_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."att_leave_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "att_leave_balances" ADD CONSTRAINT "att_leave_balances_leave_type_id_att_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."att_leave_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "att_leave_requests" ADD CONSTRAINT "att_leave_requests_leave_type_id_att_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."att_leave_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "att_time_logs" ADD CONSTRAINT "att_time_logs_project_id_att_time_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."att_time_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "att_user_profiles" ADD CONSTRAINT "att_user_profiles_shift_id_att_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."att_shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "att_attendance_user_date_uq" ON "att_attendance" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "att_attendance_date_idx" ON "att_attendance" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "att_compoff_live_uq" ON "att_compoff_requests" USING btree ("user_id","worked_date") WHERE status in ('pending', 'approved', 'used');--> statement-breakpoint
CREATE INDEX "att_compoff_status_idx" ON "att_compoff_requests" USING btree ("status","approver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "att_holidays_date_uq" ON "att_holidays" USING btree ("date");--> statement-breakpoint
CREATE INDEX "att_holidays_year_idx" ON "att_holidays" USING btree ("year");--> statement-breakpoint
CREATE INDEX "att_leave_adjustments_user_idx" ON "att_leave_adjustments" USING btree ("user_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX "att_leave_balances_uq" ON "att_leave_balances" USING btree ("user_id","leave_type_id","year");--> statement-breakpoint
CREATE INDEX "att_leave_requests_user_idx" ON "att_leave_requests" USING btree ("user_id","start_date");--> statement-breakpoint
CREATE INDEX "att_leave_requests_status_idx" ON "att_leave_requests" USING btree ("status","approver_id");--> statement-breakpoint
CREATE INDEX "att_leave_requests_dates_idx" ON "att_leave_requests" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE UNIQUE INDEX "att_regularization_live_uq" ON "att_regularization_requests" USING btree ("user_id","date") WHERE status in ('pending', 'approved');--> statement-breakpoint
CREATE INDEX "att_regularization_status_idx" ON "att_regularization_requests" USING btree ("status","approver_id");--> statement-breakpoint
CREATE INDEX "att_time_logs_user_week_idx" ON "att_time_logs" USING btree ("user_id","week_start_date");--> statement-breakpoint
CREATE INDEX "att_time_logs_project_idx" ON "att_time_logs" USING btree ("project_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "att_timesheets_user_week_uq" ON "att_timesheets" USING btree ("user_id","week_start_date");--> statement-breakpoint
CREATE INDEX "att_timesheets_status_idx" ON "att_timesheets" USING btree ("status","approver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "att_wfh_live_uq" ON "att_wfh_requests" USING btree ("user_id","date") WHERE status in ('pending', 'approved');--> statement-breakpoint
CREATE INDEX "att_wfh_status_idx" ON "att_wfh_requests" USING btree ("status","approver_id");--> statement-breakpoint
CREATE INDEX "att_wfh_date_idx" ON "att_wfh_requests" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "att_wishes_once_uq" ON "att_wishes" USING btree ("from_user_id","to_user_id","event_type","event_date");--> statement-breakpoint
CREATE INDEX "att_wishes_to_idx" ON "att_wishes" USING btree ("to_user_id","event_date");--> statement-breakpoint
INSERT INTO "att_shifts" ("id", "name", "start_time", "end_time", "grace_minutes", "full_day_hours", "half_day_hours", "first_half_end", "second_half_start", "is_default") VALUES
	('a7700000-0000-4000-8000-000000000001', 'General', '10:00', '17:30', 45, 7.5, 4, '14:00', '14:00', true)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "att_leave_types" ("id", "name", "color", "days_per_year", "accrual_type", "carry_forward_cap", "notice_period_days", "allow_half_day", "half_day_first", "half_day_second", "requires_document_after_days", "requires_reason", "available_to", "count_weekends", "is_compoff", "sort_order") VALUES
	('a7700000-0000-4000-8000-000000000011', 'Casual Leave', 'blue', 12, 'full_year', 0, 1, true, true, true, NULL, false, 'all', false, false, 1),
	('a7700000-0000-4000-8000-000000000012', 'Sick Leave', 'red', 8, 'full_year', 0, 0, false, true, true, 3, true, 'all', false, false, 2),
	('a7700000-0000-4000-8000-000000000013', 'Privileged Leave', 'green', 15, 'full_year', 10, 7, false, true, true, NULL, true, 'all', false, false, 3),
	('a7700000-0000-4000-8000-000000000014', 'Comp-off', 'orange', 0, 'full_year', 0, 0, true, true, true, NULL, false, 'all', false, true, 4)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "att_settings" ("key", "value") VALUES ('config', '{}'::jsonb) ON CONFLICT ("key") DO NOTHING;
