-- Applies migration 0044 (Attendance: check-in/out, leave, WFH, regularization, comp-off, time tracking, feeds) to the live database, by hand.
-- Paste the whole file into the SQL Editor of the database production uses (check DB_DRIVER in Vercel: "pg" means Supabase, otherwise Neon; and
-- use the database DATABASE_URL points to) and run it BEFORE this code is deployed. It depends on nothing beyond the hub's own tables.
--
-- Safe to run more than once, and it changes no existing row:
--   - only NEW tables and types, every one prefixed att_ (17 tables, 10 types). No hub table is touched (a person's reporting manager is the
--     hub's own users.reporting_manager_id, which Attendance reads and HR edit through it; nothing about it changes here).
--   - the seeds: the "General" shift (10:00-17:30, 45 min grace, 7.5 h full day, 4 h half day), four leave types (Casual 12, Sick 8,
--     Privileged 15 with carry forward up to 10, Comp-off earned only) and the empty settings row (defaults: ICC Trade Tower, 150 m,
--     31-day regularization window, 2nd and 4th Saturdays off, 90-day comp-off expiry). Rows already there are left as they are.
--   - everything is in one transaction.
--   - the code running in production today never reads these tables, so it keeps working, and so does Instant Rollback.
--   - Attendance stays switched off until ATT_ENABLED=true is set in Vercel, so the tables can exist before anyone uses them.
--
-- Leave documents are NOT stored in the database: they go to the private Supabase Storage bucket "attendance-files" (create it in Supabase →
-- Storage, with "Public bucket" OFF), with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set in Vercel (already there for DesignDesk, AI Studio, ERU).
--
-- To undo it (throws away every attendance record, request, balance, timesheet, wish and setting; documents in the bucket stay until you empty it):
--   DROP TABLE IF EXISTS att_wishes, att_leave_adjustments, att_settings, att_announcements, att_timesheets, att_time_logs, att_time_projects,
--     att_compoff_requests, att_regularization_requests, att_wfh_requests, att_leave_requests, att_leave_balances, att_leave_types, att_attendance,
--     att_holidays, att_user_profiles, att_shifts CASCADE;
--   DROP TYPE IF EXISTS att_check_in_method, att_day_status, att_employment_type, att_half_day, att_request_status, att_compoff_status,
--     att_compoff_type, att_timesheet_status, att_missed_punch, att_accrual_type;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '4dd2745f542d2fbd4a57b9819f2d65905a8ded21a56207fc8f03559f85c00075';

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'att_accrual_type') THEN
    CREATE TYPE "public"."att_accrual_type" AS ENUM('full_year', 'monthly');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'att_check_in_method') THEN
    CREATE TYPE "public"."att_check_in_method" AS ENUM('gps', 'ip', 'manual', 'wfh');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'att_compoff_status') THEN
    CREATE TYPE "public"."att_compoff_status" AS ENUM('pending', 'approved', 'rejected', 'used', 'expired', 'cancelled');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'att_compoff_type') THEN
    CREATE TYPE "public"."att_compoff_type" AS ENUM('full', 'half');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'att_day_status') THEN
    CREATE TYPE "public"."att_day_status" AS ENUM('present', 'absent', 'half_day', 'holiday', 'weekly_off', 'leave', 'wfh');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'att_employment_type') THEN
    CREATE TYPE "public"."att_employment_type" AS ENUM('intern', 'consultant', 'staff');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'att_half_day') THEN
    CREATE TYPE "public"."att_half_day" AS ENUM('none', 'first', 'second');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'att_missed_punch') THEN
    CREATE TYPE "public"."att_missed_punch" AS ENUM('checkin', 'checkout', 'both');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'att_request_status') THEN
    CREATE TYPE "public"."att_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'att_timesheet_status') THEN
    CREATE TYPE "public"."att_timesheet_status" AS ENUM('draft', 'submitted', 'approved', 'rejected');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "att_announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "att_attendance" (
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

CREATE TABLE IF NOT EXISTS "att_compoff_requests" (
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

CREATE TABLE IF NOT EXISTS "att_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"is_optional" boolean DEFAULT false NOT NULL,
	"year" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "att_leave_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"days" numeric(6, 2) NOT NULL,
	"remark" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "att_leave_balances" (
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

CREATE TABLE IF NOT EXISTS "att_leave_requests" (
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

CREATE TABLE IF NOT EXISTS "att_leave_types" (
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

CREATE TABLE IF NOT EXISTS "att_regularization_requests" (
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

CREATE TABLE IF NOT EXISTS "att_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "att_shifts" (
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

CREATE TABLE IF NOT EXISTS "att_time_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"date" date NOT NULL,
	"hours" numeric(6, 2) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"week_start_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "att_time_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "att_timesheets" (
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

CREATE TABLE IF NOT EXISTS "att_user_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"shift_id" uuid,
	"employment_type" "att_employment_type" DEFAULT 'staff' NOT NULL,
	"date_of_joining" date,
	"date_of_birth" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "att_user_profiles_user_id_unique" UNIQUE("user_id")
);

CREATE TABLE IF NOT EXISTS "att_wfh_requests" (
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

CREATE TABLE IF NOT EXISTS "att_wishes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"event_date" date NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'att_leave_adjustments_leave_type_id_att_leave_types_id_fk') THEN
    ALTER TABLE "att_leave_adjustments" ADD CONSTRAINT "att_leave_adjustments_leave_type_id_att_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."att_leave_types"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'att_leave_balances_leave_type_id_att_leave_types_id_fk') THEN
    ALTER TABLE "att_leave_balances" ADD CONSTRAINT "att_leave_balances_leave_type_id_att_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."att_leave_types"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'att_leave_requests_leave_type_id_att_leave_types_id_fk') THEN
    ALTER TABLE "att_leave_requests" ADD CONSTRAINT "att_leave_requests_leave_type_id_att_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."att_leave_types"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'att_time_logs_project_id_att_time_projects_id_fk') THEN
    ALTER TABLE "att_time_logs" ADD CONSTRAINT "att_time_logs_project_id_att_time_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."att_time_projects"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'att_user_profiles_shift_id_att_shifts_id_fk') THEN
    ALTER TABLE "att_user_profiles" ADD CONSTRAINT "att_user_profiles_shift_id_att_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."att_shifts"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "att_attendance_user_date_uq" ON "att_attendance" USING btree ("user_id","date");

CREATE INDEX IF NOT EXISTS "att_attendance_date_idx" ON "att_attendance" USING btree ("date");

CREATE UNIQUE INDEX IF NOT EXISTS "att_compoff_live_uq" ON "att_compoff_requests" USING btree ("user_id","worked_date") WHERE status in ('pending', 'approved', 'used');

CREATE INDEX IF NOT EXISTS "att_compoff_status_idx" ON "att_compoff_requests" USING btree ("status","approver_id");

CREATE UNIQUE INDEX IF NOT EXISTS "att_holidays_date_uq" ON "att_holidays" USING btree ("date");

CREATE INDEX IF NOT EXISTS "att_holidays_year_idx" ON "att_holidays" USING btree ("year");

CREATE INDEX IF NOT EXISTS "att_leave_adjustments_user_idx" ON "att_leave_adjustments" USING btree ("user_id","year");

CREATE UNIQUE INDEX IF NOT EXISTS "att_leave_balances_uq" ON "att_leave_balances" USING btree ("user_id","leave_type_id","year");

CREATE INDEX IF NOT EXISTS "att_leave_requests_user_idx" ON "att_leave_requests" USING btree ("user_id","start_date");

CREATE INDEX IF NOT EXISTS "att_leave_requests_status_idx" ON "att_leave_requests" USING btree ("status","approver_id");

CREATE INDEX IF NOT EXISTS "att_leave_requests_dates_idx" ON "att_leave_requests" USING btree ("start_date","end_date");

CREATE UNIQUE INDEX IF NOT EXISTS "att_regularization_live_uq" ON "att_regularization_requests" USING btree ("user_id","date") WHERE status in ('pending', 'approved');

CREATE INDEX IF NOT EXISTS "att_regularization_status_idx" ON "att_regularization_requests" USING btree ("status","approver_id");

CREATE INDEX IF NOT EXISTS "att_time_logs_user_week_idx" ON "att_time_logs" USING btree ("user_id","week_start_date");

CREATE INDEX IF NOT EXISTS "att_time_logs_project_idx" ON "att_time_logs" USING btree ("project_id","date");

CREATE UNIQUE INDEX IF NOT EXISTS "att_timesheets_user_week_uq" ON "att_timesheets" USING btree ("user_id","week_start_date");

CREATE INDEX IF NOT EXISTS "att_timesheets_status_idx" ON "att_timesheets" USING btree ("status","approver_id");

CREATE UNIQUE INDEX IF NOT EXISTS "att_wfh_live_uq" ON "att_wfh_requests" USING btree ("user_id","date") WHERE status in ('pending', 'approved');

CREATE INDEX IF NOT EXISTS "att_wfh_status_idx" ON "att_wfh_requests" USING btree ("status","approver_id");

CREATE INDEX IF NOT EXISTS "att_wfh_date_idx" ON "att_wfh_requests" USING btree ("date");

CREATE UNIQUE INDEX IF NOT EXISTS "att_wishes_once_uq" ON "att_wishes" USING btree ("from_user_id","to_user_id","event_type","event_date");

CREATE INDEX IF NOT EXISTS "att_wishes_to_idx" ON "att_wishes" USING btree ("to_user_id","event_date");

INSERT INTO "att_shifts" ("id", "name", "start_time", "end_time", "grace_minutes", "full_day_hours", "half_day_hours", "first_half_end", "second_half_start", "is_default") VALUES
	('a7700000-0000-4000-8000-000000000001', 'General', '10:00', '17:30', 45, 7.5, 4, '14:00', '14:00', true)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "att_leave_types" ("id", "name", "color", "days_per_year", "accrual_type", "carry_forward_cap", "notice_period_days", "allow_half_day", "half_day_first", "half_day_second", "requires_document_after_days", "requires_reason", "available_to", "count_weekends", "is_compoff", "sort_order") VALUES
	('a7700000-0000-4000-8000-000000000011', 'Casual Leave', 'blue', 12, 'full_year', 0, 1, true, true, true, NULL, false, 'all', false, false, 1),
	('a7700000-0000-4000-8000-000000000012', 'Sick Leave', 'red', 8, 'full_year', 0, 0, false, true, true, 3, true, 'all', false, false, 2),
	('a7700000-0000-4000-8000-000000000013', 'Privileged Leave', 'green', 15, 'full_year', 10, 7, false, true, true, NULL, true, 'all', false, false, 3),
	('a7700000-0000-4000-8000-000000000014', 'Comp-off', 'orange', 0, 'full_year', 0, 0, true, true, true, NULL, false, 'all', false, true, 4)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "att_settings" ("key", "value") VALUES ('config', '{}'::jsonb) ON CONFLICT ("key") DO NOTHING;

-- Records the migration as applied, so drizzle-kit migrate never runs it again.
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '4dd2745f542d2fbd4a57b9819f2d65905a8ded21a56207fc8f03559f85c00075', 1795255180532
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '4dd2745f542d2fbd4a57b9819f2d65905a8ded21a56207fc8f03559f85c00075');

COMMIT;

-- Afterwards this should return 17, 10, 1, 4 and 1:
-- SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'att\_%') AS att_tables,
--        (SELECT count(*) FROM pg_type WHERE typname LIKE 'att\_%' AND typtype = 'e') AS att_types,
--        (SELECT count(*) FROM att_shifts) AS shifts,
--        (SELECT count(*) FROM att_leave_types) AS leave_types,
--        (SELECT count(*) FROM att_settings) AS settings_rows;
