-- AppHub: the whole database structure (48 tables, 14 enums, their constraints and indexes), for a NEW, EMPTY Supabase database.
-- Generated from src/db/schema.ts, src/db/approvals-schema.ts and src/db/inventory-schema.ts (the same as migrations 0000-0022 applied
-- in order). It holds no data: load that afterwards with scripts/neon-data-export.sql (made by scripts/export-neon-data.mjs).
--
-- HOW TO RUN (see docs/SUPABASE-MIGRATION.md):
--   psql "<Supabase session pooler or direct URL, port 5432>" -v ON_ERROR_STOP=1 -f scripts/migrate-to-supabase.sql
--   or paste it into Supabase → SQL Editor and run.
--
-- SAFE TO RUN TWICE: every type, table, constraint and index is created only if it is missing, and all of it is one transaction
-- (any error and nothing is kept). Note: "if it is missing" goes by NAME. A table that already exists is left exactly as it is, even
-- if its columns differ, so run this on an empty database. NEVER run it on Neon: it is only for the new database.

BEGIN;

-- gen_random_uuid() is built into Postgres 13 and later; nothing else is needed.

-- ════════════════════════════════════════════════════════════════ ENUMS (14)

DO $$ BEGIN
  CREATE TYPE "public"."activity_action" AS ENUM('login', 'launch');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."app_status" AS ENUM('active', 'testing', 'unavailable');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."department_kind" AS ENUM('organisation', 'application');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."role" AS ENUM('head_admin', 'dept_lead', 'member', 'super_admin', 'admin', 'hr_admin', 'expense_admin');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."user_status" AS ENUM('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."apr_attachment_slot" AS ENUM('file_upload', 'file_upload_2', 'tax_invoice', 'quotation', 'supporting');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."apr_event_action" AS ENUM('submitted', 'assigned', 'approved', 'rejected', 'withdrawn', 'resubmitted', 'reassigned', 'comment', 'viewed', 'returned');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."apr_request_status" AS ENUM('draft', 'pending', 'approved', 'rejected', 'withdrawn', 'returned');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."apr_request_type" AS ENUM('hr', 'expenditure_small', 'expenditure_large');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."apr_step_status" AS ENUM('waiting', 'pending', 'approved', 'rejected', 'skipped', 'returned');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."inventory_movement_kind" AS ENUM('inward', 'issue', 'return', 'adjust', 'recount');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."inventory_po_status" AS ENUM('draft', 'sent', 'received', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."inventory_request_status" AS ENUM('pending', 'approved', 'fulfilled', 'rejected', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "public"."inventory_ticket_status" AS ENUM('open', 'in_progress', 'resolved');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ════════════════════════════════════════════════════════════════ HUB (core: people, departments, applications, access, audit): 16 tables

-- departments
CREATE TABLE IF NOT EXISTS "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "department_kind" DEFAULT 'application' NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"icon" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_kind_name_uq" UNIQUE("kind","name"),
	CONSTRAINT "departments_kind_slug_uq" UNIQUE("kind","slug")
);

-- branches
CREATE TABLE IF NOT EXISTS "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_name_unique" UNIQUE("name")
);

-- teams
CREATE TABLE IF NOT EXISTS "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"branch_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_name_unique" UNIQUE("name")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teams_branch_id_branches_id_fk' AND conrelid = '"public"."teams"'::regclass) THEN
    ALTER TABLE "teams" ADD CONSTRAINT "teams_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "teams_branch_idx" ON "teams" USING btree ("branch_id");

-- users
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" "role" DEFAULT 'member' NOT NULL,
	"admin_areas" text[] DEFAULT '{}'::text[] NOT NULL,
	"home_department_id" uuid,
	"branch_id" uuid,
	"team_id" uuid,
	"reporting_manager_id" uuid,
	"phone" text,
	"designation" text,
	"password_hash" text,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"status" "user_status" DEFAULT 'approved' NOT NULL,
	"signup_source" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_id" uuid,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_home_department_id_departments_id_fk' AND conrelid = '"public"."users"'::regclass) THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_home_department_id_departments_id_fk" FOREIGN KEY ("home_department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_branch_id_branches_id_fk' AND conrelid = '"public"."users"'::regclass) THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_team_id_teams_id_fk' AND conrelid = '"public"."users"'::regclass) THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_reporting_manager_id_users_id_fk' AND conrelid = '"public"."users"'::regclass) THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_reporting_manager_id_users_id_fk" FOREIGN KEY ("reporting_manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "users_branch_idx" ON "users" USING btree ("branch_id");
CREATE INDEX IF NOT EXISTS "users_team_idx" ON "users" USING btree ("team_id");
CREATE INDEX IF NOT EXISTS "users_manager_idx" ON "users" USING btree ("reporting_manager_id");
CREATE INDEX IF NOT EXISTS "users_department_idx" ON "users" USING btree ("home_department_id");
CREATE UNIQUE INDEX IF NOT EXISTS "users_one_super_admin" ON "users" USING btree ("role") WHERE "users"."role" = 'super_admin';
CREATE UNIQUE INDEX IF NOT EXISTS "users_one_hr_admin" ON "users" USING btree ("role") WHERE "users"."role" = 'hr_admin';
CREATE UNIQUE INDEX IF NOT EXISTS "users_one_expense_admin" ON "users" USING btree ("role") WHERE "users"."role" = 'expense_admin';

-- apps
CREATE TABLE IF NOT EXISTS "apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"department_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"url" text NOT NULL,
	"app_token" text,
	"icon" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"status" "app_status" DEFAULT 'active' NOT NULL,
	"sso_enabled" boolean DEFAULT false NOT NULL,
	"sso_slug" text,
	"sso_callback_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apps_department_id_departments_id_fk' AND conrelid = '"public"."apps"'::regclass) THEN
    ALTER TABLE "apps" ADD CONSTRAINT "apps_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "apps_department_idx" ON "apps" USING btree ("department_id");
CREATE UNIQUE INDEX IF NOT EXISTS "apps_sso_slug_uq" ON "apps" USING btree ("sso_slug") WHERE "apps"."sso_slug" is not null;

-- app_checks
CREATE TABLE IF NOT EXISTS "app_checks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"app_id" uuid NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_by_id" uuid,
	"ok" boolean NOT NULL,
	"http_status" integer,
	"duration_ms" integer,
	"detail" text NOT NULL
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_checks_app_id_apps_id_fk' AND conrelid = '"public"."app_checks"'::regclass) THEN
    ALTER TABLE "app_checks" ADD CONSTRAINT "app_checks_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_checks_checked_by_id_users_id_fk' AND conrelid = '"public"."app_checks"'::regclass) THEN
    ALTER TABLE "app_checks" ADD CONSTRAINT "app_checks_checked_by_id_users_id_fk" FOREIGN KEY ("checked_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "app_checks_app_idx" ON "app_checks" USING btree ("app_id","checked_at");

-- user_invites
CREATE TABLE IF NOT EXISTS "user_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by_id" uuid,
	"delivery" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_invites_token_hash_unique" UNIQUE("token_hash")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_invites_user_id_users_id_fk' AND conrelid = '"public"."user_invites"'::regclass) THEN
    ALTER TABLE "user_invites" ADD CONSTRAINT "user_invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_invites_created_by_id_users_id_fk' AND conrelid = '"public"."user_invites"'::regclass) THEN
    ALTER TABLE "user_invites" ADD CONSTRAINT "user_invites_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "user_invites_user_idx" ON "user_invites" USING btree ("user_id");

-- access_audit
CREATE TABLE IF NOT EXISTS "access_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_name" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"target_label" text DEFAULT '' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'access_audit_actor_id_users_id_fk' AND conrelid = '"public"."access_audit"'::regclass) THEN
    ALTER TABLE "access_audit" ADD CONSTRAINT "access_audit_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "access_audit_at_idx" ON "access_audit" USING btree ("at");
CREATE INDEX IF NOT EXISTS "access_audit_target_idx" ON "access_audit" USING btree ("target_id");
CREATE INDEX IF NOT EXISTS "access_audit_actor_idx" ON "access_audit" USING btree ("actor_id");

-- user_department_access
CREATE TABLE IF NOT EXISTS "user_department_access" (
	"user_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	CONSTRAINT "user_department_access_user_id_department_id_pk" PRIMARY KEY("user_id","department_id")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_department_access_user_id_users_id_fk' AND conrelid = '"public"."user_department_access"'::regclass) THEN
    ALTER TABLE "user_department_access" ADD CONSTRAINT "user_department_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_department_access_department_id_departments_id_fk' AND conrelid = '"public"."user_department_access"'::regclass) THEN
    ALTER TABLE "user_department_access" ADD CONSTRAINT "user_department_access_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

-- app_admins
CREATE TABLE IF NOT EXISTS "app_admins" (
	"app_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_by_id" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_admins_app_id_user_id_pk" PRIMARY KEY("app_id","user_id")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_admins_app_id_apps_id_fk' AND conrelid = '"public"."app_admins"'::regclass) THEN
    ALTER TABLE "app_admins" ADD CONSTRAINT "app_admins_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_admins_user_id_users_id_fk' AND conrelid = '"public"."app_admins"'::regclass) THEN
    ALTER TABLE "app_admins" ADD CONSTRAINT "app_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_admins_added_by_id_users_id_fk' AND conrelid = '"public"."app_admins"'::regclass) THEN
    ALTER TABLE "app_admins" ADD CONSTRAINT "app_admins_added_by_id_users_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "app_admins_user_idx" ON "app_admins" USING btree ("user_id");

-- user_app_access
CREATE TABLE IF NOT EXISTS "user_app_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	"granted_by_id" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"app_role" text DEFAULT 'user' NOT NULL,
	CONSTRAINT "user_app_access_user_app_uq" UNIQUE("user_id","app_id"),
	CONSTRAINT "user_app_access_app_role_check" CHECK ("user_app_access"."app_role" in ('user', 'admin', 'super_admin'))
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_app_access_user_id_users_id_fk' AND conrelid = '"public"."user_app_access"'::regclass) THEN
    ALTER TABLE "user_app_access" ADD CONSTRAINT "user_app_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_app_access_app_id_apps_id_fk' AND conrelid = '"public"."user_app_access"'::regclass) THEN
    ALTER TABLE "user_app_access" ADD CONSTRAINT "user_app_access_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_app_access_granted_by_id_users_id_fk' AND conrelid = '"public"."user_app_access"'::regclass) THEN
    ALTER TABLE "user_app_access" ADD CONSTRAINT "user_app_access_granted_by_id_users_id_fk" FOREIGN KEY ("granted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "user_app_access_app_idx" ON "user_app_access" USING btree ("app_id");

-- hub_notifications
CREATE TABLE IF NOT EXISTS "hub_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_notifications_user_dedupe_uq" UNIQUE("user_id","dedupe_key")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hub_notifications_user_id_users_id_fk' AND conrelid = '"public"."hub_notifications"'::regclass) THEN
    ALTER TABLE "hub_notifications" ADD CONSTRAINT "hub_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "hub_notifications_user_idx" ON "hub_notifications" USING btree ("user_id","created_at");

-- access_templates
CREATE TABLE IF NOT EXISTS "access_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_templates_name_unique" UNIQUE("name")
);

-- access_template_apps
CREATE TABLE IF NOT EXISTS "access_template_apps" (
	"template_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	CONSTRAINT "access_template_apps_template_id_app_id_pk" PRIMARY KEY("template_id","app_id")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'access_template_apps_template_id_access_templates_id_fk' AND conrelid = '"public"."access_template_apps"'::regclass) THEN
    ALTER TABLE "access_template_apps" ADD CONSTRAINT "access_template_apps_template_id_access_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."access_templates"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'access_template_apps_app_id_apps_id_fk' AND conrelid = '"public"."access_template_apps"'::regclass) THEN
    ALTER TABLE "access_template_apps" ADD CONSTRAINT "access_template_apps_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

-- login_attempts
CREATE TABLE IF NOT EXISTS "login_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"ip_address" text,
	"success" boolean NOT NULL,
	"kind" text DEFAULT 'login' NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "login_attempts_email_idx" ON "login_attempts" USING btree ("email","created_at");
CREATE INDEX IF NOT EXISTS "login_attempts_ip_idx" ON "login_attempts" USING btree ("ip_address","created_at");

-- activity_log
CREATE TABLE IF NOT EXISTS "activity_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"app_id" uuid,
	"department_id" uuid,
	"action" "activity_action" DEFAULT 'launch' NOT NULL,
	"ip_address" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activity_log_user_id_users_id_fk' AND conrelid = '"public"."activity_log"'::regclass) THEN
    ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activity_log_app_id_apps_id_fk' AND conrelid = '"public"."activity_log"'::regclass) THEN
    ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "activity_opened_at_idx" ON "activity_log" USING btree ("opened_at");
CREATE INDEX IF NOT EXISTS "activity_user_idx" ON "activity_log" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "activity_app_idx" ON "activity_log" USING btree ("app_id");

-- ════════════════════════════════════════════════════════════════ APPROVALS module (apr_*; people are user ids without foreign keys, on purpose): 23 tables

-- apr_categories
CREATE TABLE IF NOT EXISTS "apr_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"duplicate_group" text,
	"merged_into_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "apr_categories_name_uq" ON "apr_categories" USING btree (lower("name"));

-- apr_hr_categories
CREATE TABLE IF NOT EXISTS "apr_hr_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "apr_hr_categories_name_uq" ON "apr_hr_categories" USING btree (lower("name"));

-- apr_branches
CREATE TABLE IF NOT EXISTS "apr_branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "apr_branches_name_uq" ON "apr_branches" USING btree (lower("name"));

-- apr_publication_types
CREATE TABLE IF NOT EXISTS "apr_publication_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "apr_publication_types_name_uq" ON "apr_publication_types" USING btree (lower("name"));

-- apr_publications
CREATE TABLE IF NOT EXISTS "apr_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publication_type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apr_publications_publication_type_id_apr_publication_types_id_f' AND conrelid = '"public"."apr_publications"'::regclass) THEN
    ALTER TABLE "apr_publications" ADD CONSTRAINT "apr_publications_publication_type_id_apr_publication_types_id_f" FOREIGN KEY ("publication_type_id") REFERENCES "public"."apr_publication_types"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "apr_publications_name_uq" ON "apr_publications" USING btree ("publication_type_id",lower("name"));

-- apr_budgets
CREATE TABLE IF NOT EXISTS "apr_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"financial_year" text NOT NULL,
	"branch_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"allocated_paise" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apr_budgets_fy_branch_category_uq" UNIQUE("financial_year","branch_id","category_id")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apr_budgets_branch_id_apr_branches_id_fk' AND conrelid = '"public"."apr_budgets"'::regclass) THEN
    ALTER TABLE "apr_budgets" ADD CONSTRAINT "apr_budgets_branch_id_apr_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."apr_branches"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apr_budgets_category_id_apr_categories_id_fk' AND conrelid = '"public"."apr_budgets"'::regclass) THEN
    ALTER TABLE "apr_budgets" ADD CONSTRAINT "apr_budgets_category_id_apr_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."apr_categories"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;

-- apr_category_budgets
CREATE TABLE IF NOT EXISTS "apr_category_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"financial_year" text NOT NULL,
	"category_id" uuid NOT NULL,
	"allocated_paise" bigint NOT NULL,
	"updated_by_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apr_category_budgets_fy_category_uq" UNIQUE("financial_year","category_id")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apr_category_budgets_category_id_apr_categories_id_fk' AND conrelid = '"public"."apr_category_budgets"'::regclass) THEN
    ALTER TABLE "apr_category_budgets" ADD CONSTRAINT "apr_category_budgets_category_id_apr_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."apr_categories"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;

-- apr_approver_rules
CREATE TABLE IF NOT EXISTS "apr_approver_rules" (
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

-- apr_settings
CREATE TABLE IF NOT EXISTS "apr_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- apr_user_roles
CREATE TABLE IF NOT EXISTS "apr_user_roles" (
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"granted_by_id" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apr_user_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);

-- apr_counters
CREATE TABLE IF NOT EXISTS "apr_counters" (
	"key" text PRIMARY KEY NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL
);

-- apr_requests
CREATE TABLE IF NOT EXISTS "apr_requests" (
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
	"custom_values" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"over_budget" boolean DEFAULT false NOT NULL,
	"resubmitted_from_id" uuid,
	"legacy_id" text,
	"reminder_last_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apr_requests_request_no_unique" UNIQUE("request_no"),
	CONSTRAINT "apr_requests_legacy_id_unique" UNIQUE("legacy_id")
);
CREATE INDEX IF NOT EXISTS "apr_requests_status_idx" ON "apr_requests" USING btree ("status");
CREATE INDEX IF NOT EXISTS "apr_requests_type_idx" ON "apr_requests" USING btree ("type");
CREATE INDEX IF NOT EXISTS "apr_requests_requester_idx" ON "apr_requests" USING btree ("requester_user_id");
CREATE INDEX IF NOT EXISTS "apr_requests_approver_idx" ON "apr_requests" USING btree ("current_approver_user_id");
CREATE INDEX IF NOT EXISTS "apr_requests_requested_at_idx" ON "apr_requests" USING btree ("requested_at");
CREATE INDEX IF NOT EXISTS "apr_requests_fy_idx" ON "apr_requests" USING btree ("financial_year");

-- apr_form_fields
CREATE TABLE IF NOT EXISTS "apr_form_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"options" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apr_form_fields_form_key_uq" UNIQUE("form","key")
);

-- apr_expenditure_details
CREATE TABLE IF NOT EXISTS "apr_expenditure_details" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"category_id" uuid NOT NULL,
	"nature_of_expenditure" text,
	"branch_id" uuid,
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
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apr_expenditure_details_request_id_apr_requests_id_fk' AND conrelid = '"public"."apr_expenditure_details"'::regclass) THEN
    ALTER TABLE "apr_expenditure_details" ADD CONSTRAINT "apr_expenditure_details_request_id_apr_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."apr_requests"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apr_expenditure_details_category_id_apr_categories_id_fk' AND conrelid = '"public"."apr_expenditure_details"'::regclass) THEN
    ALTER TABLE "apr_expenditure_details" ADD CONSTRAINT "apr_expenditure_details_category_id_apr_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."apr_categories"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apr_expenditure_details_branch_id_apr_branches_id_fk' AND conrelid = '"public"."apr_expenditure_details"'::regclass) THEN
    ALTER TABLE "apr_expenditure_details" ADD CONSTRAINT "apr_expenditure_details_branch_id_apr_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."apr_branches"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apr_expenditure_details_publication_type_id_apr_publication_typ' AND conrelid = '"public"."apr_expenditure_details"'::regclass) THEN
    ALTER TABLE "apr_expenditure_details" ADD CONSTRAINT "apr_expenditure_details_publication_type_id_apr_publication_typ" FOREIGN KEY ("publication_type_id") REFERENCES "public"."apr_publication_types"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apr_expenditure_details_publication_id_apr_publications_id_fk' AND conrelid = '"public"."apr_expenditure_details"'::regclass) THEN
    ALTER TABLE "apr_expenditure_details" ADD CONSTRAINT "apr_expenditure_details_publication_id_apr_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."apr_publications"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;

-- apr_hr_details
CREATE TABLE IF NOT EXISTS "apr_hr_details" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"hr_category_id" uuid NOT NULL,
	"description" text,
	"branch_id" uuid,
	"budget_category_id" uuid,
	"budget_allocated_paise" bigint,
	"budget_available_paise" bigint,
	"budget_remaining_paise" bigint
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apr_hr_details_request_id_apr_requests_id_fk' AND conrelid = '"public"."apr_hr_details"'::regclass) THEN
    ALTER TABLE "apr_hr_details" ADD CONSTRAINT "apr_hr_details_request_id_apr_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."apr_requests"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apr_hr_details_hr_category_id_apr_hr_categories_id_fk' AND conrelid = '"public"."apr_hr_details"'::regclass) THEN
    ALTER TABLE "apr_hr_details" ADD CONSTRAINT "apr_hr_details_hr_category_id_apr_hr_categories_id_fk" FOREIGN KEY ("hr_category_id") REFERENCES "public"."apr_hr_categories"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apr_hr_details_branch_id_apr_branches_id_fk' AND conrelid = '"public"."apr_hr_details"'::regclass) THEN
    ALTER TABLE "apr_hr_details" ADD CONSTRAINT "apr_hr_details_branch_id_apr_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."apr_branches"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apr_hr_details_budget_category_id_apr_categories_id_fk' AND conrelid = '"public"."apr_hr_details"'::regclass) THEN
    ALTER TABLE "apr_hr_details" ADD CONSTRAINT "apr_hr_details_budget_category_id_apr_categories_id_fk" FOREIGN KEY ("budget_category_id") REFERENCES "public"."apr_categories"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;

-- apr_attachments
CREATE TABLE IF NOT EXISTS "apr_attachments" (
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
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apr_attachments_request_id_apr_requests_id_fk' AND conrelid = '"public"."apr_attachments"'::regclass) THEN
    ALTER TABLE "apr_attachments" ADD CONSTRAINT "apr_attachments_request_id_apr_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."apr_requests"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "apr_attachments_request_idx" ON "apr_attachments" USING btree ("request_id");

-- apr_files
CREATE TABLE IF NOT EXISTS "apr_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"file_name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"chunk_count" integer NOT NULL,
	"attached" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "apr_files_uploader_idx" ON "apr_files" USING btree ("uploaded_by","created_at");

-- apr_file_chunks
CREATE TABLE IF NOT EXISTS "apr_file_chunks" (
	"file_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"data" "bytea" NOT NULL,
	CONSTRAINT "apr_file_chunks_file_id_idx_pk" PRIMARY KEY("file_id","idx")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apr_file_chunks_file_id_apr_files_id_fk' AND conrelid = '"public"."apr_file_chunks"'::regclass) THEN
    ALTER TABLE "apr_file_chunks" ADD CONSTRAINT "apr_file_chunks_file_id_apr_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."apr_files"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

-- apr_request_steps
CREATE TABLE IF NOT EXISTS "apr_request_steps" (
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
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apr_request_steps_request_id_apr_requests_id_fk' AND conrelid = '"public"."apr_request_steps"'::regclass) THEN
    ALTER TABLE "apr_request_steps" ADD CONSTRAINT "apr_request_steps_request_id_apr_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."apr_requests"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "apr_request_steps_approver_idx" ON "apr_request_steps" USING btree ("approver_user_id","status");

-- apr_approval_events
CREATE TABLE IF NOT EXISTS "apr_approval_events" (
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
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apr_approval_events_request_id_apr_requests_id_fk' AND conrelid = '"public"."apr_approval_events"'::regclass) THEN
    ALTER TABLE "apr_approval_events" ADD CONSTRAINT "apr_approval_events_request_id_apr_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."apr_requests"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "apr_approval_events_request_idx" ON "apr_approval_events" USING btree ("request_id","created_at");

-- apr_notifications
CREATE TABLE IF NOT EXISTS "apr_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"request_id" uuid,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apr_notifications_request_id_apr_requests_id_fk' AND conrelid = '"public"."apr_notifications"'::regclass) THEN
    ALTER TABLE "apr_notifications" ADD CONSTRAINT "apr_notifications_request_id_apr_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."apr_requests"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "apr_notifications_user_idx" ON "apr_notifications" USING btree ("user_id","created_at");

-- apr_admin_audit
CREATE TABLE IF NOT EXISTS "apr_admin_audit" (
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
CREATE INDEX IF NOT EXISTS "apr_admin_audit_created_idx" ON "apr_admin_audit" USING btree ("created_at");

-- apr_rate_limits
CREATE TABLE IF NOT EXISTS "apr_rate_limits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"bucket" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "apr_rate_limits_idx" ON "apr_rate_limits" USING btree ("bucket","user_id","created_at");

-- ════════════════════════════════════════════════════════════════ INVENTORY module (inventory_*; people are user ids without foreign keys, on purpose): 9 tables

-- inventory_user_roles
CREATE TABLE IF NOT EXISTS "inventory_user_roles" (
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"granted_by_id" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_user_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);

-- inventory_categories
CREATE TABLE IF NOT EXISTS "inventory_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_categories_name_uq" ON "inventory_categories" USING btree (lower("name"));

-- inventory_vendors
CREATE TABLE IF NOT EXISTS "inventory_vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"address" text,
	"gstin" text,
	"pan" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_vendors_name_uq" ON "inventory_vendors" USING btree (lower("name"));

-- inventory_items
CREATE TABLE IF NOT EXISTS "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid,
	"unit" text DEFAULT 'Nos' NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"min_quantity" integer DEFAULT 0 NOT NULL,
	"rate_paise" bigint,
	"location" text,
	"default_vendor_id" uuid,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_items_category_id_inventory_categories_id_fk' AND conrelid = '"public"."inventory_items"'::regclass) THEN
    ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_category_id_inventory_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."inventory_categories"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_items_default_vendor_id_inventory_vendors_id_fk' AND conrelid = '"public"."inventory_items"'::regclass) THEN
    ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_default_vendor_id_inventory_vendors_id_fk" FOREIGN KEY ("default_vendor_id") REFERENCES "public"."inventory_vendors"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_items_name_uq" ON "inventory_items" USING btree (lower("name"));
CREATE INDEX IF NOT EXISTS "inventory_items_category_idx" ON "inventory_items" USING btree ("category_id");

-- inventory_stock_movements
CREATE TABLE IF NOT EXISTS "inventory_stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"kind" "inventory_movement_kind" NOT NULL,
	"delta" integer NOT NULL,
	"quantity_after" integer NOT NULL,
	"reason" text,
	"issued_to_user_id" uuid,
	"issued_to_name" text,
	"issued_to_department_id" uuid,
	"event_name" text,
	"issue_id" uuid,
	"consumed" boolean DEFAULT false NOT NULL,
	"vendor_id" uuid,
	"purchase_order_id" uuid,
	"challan_no" text,
	"rate_paise" bigint,
	"request_id" uuid,
	"actor_user_id" uuid NOT NULL,
	"actor_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_stock_movements_item_id_inventory_items_id_fk' AND conrelid = '"public"."inventory_stock_movements"'::regclass) THEN
    ALTER TABLE "inventory_stock_movements" ADD CONSTRAINT "inventory_stock_movements_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_stock_movements_vendor_id_inventory_vendors_id_fk' AND conrelid = '"public"."inventory_stock_movements"'::regclass) THEN
    ALTER TABLE "inventory_stock_movements" ADD CONSTRAINT "inventory_stock_movements_vendor_id_inventory_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."inventory_vendors"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "inventory_movements_item_idx" ON "inventory_stock_movements" USING btree ("item_id","created_at");
CREATE INDEX IF NOT EXISTS "inventory_movements_kind_idx" ON "inventory_stock_movements" USING btree ("kind","created_at");
CREATE INDEX IF NOT EXISTS "inventory_movements_issue_idx" ON "inventory_stock_movements" USING btree ("issue_id");

-- inventory_requests
CREATE TABLE IF NOT EXISTS "inventory_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"note" text,
	"status" "inventory_request_status" DEFAULT 'pending' NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"requested_by_name" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by_user_id" uuid,
	"resolved_by_name" text,
	"resolved_at" timestamp with time zone,
	"reject_reason" text,
	"fulfilled_movement_id" uuid
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_requests_item_id_inventory_items_id_fk' AND conrelid = '"public"."inventory_requests"'::regclass) THEN
    ALTER TABLE "inventory_requests" ADD CONSTRAINT "inventory_requests_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "inventory_requests_status_idx" ON "inventory_requests" USING btree ("status","requested_at");
CREATE INDEX IF NOT EXISTS "inventory_requests_requester_idx" ON "inventory_requests" USING btree ("requested_by_user_id","requested_at");

-- inventory_purchase_orders
CREATE TABLE IF NOT EXISTS "inventory_purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"po_no" text,
	"vendor_id" uuid,
	"vendor_name" text NOT NULL,
	"vendor_email" text,
	"notes" text,
	"status" "inventory_po_status" DEFAULT 'draft' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	CONSTRAINT "inventory_purchase_orders_po_no_unique" UNIQUE("po_no")
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_purchase_orders_vendor_id_inventory_vendors_id_fk' AND conrelid = '"public"."inventory_purchase_orders"'::regclass) THEN
    ALTER TABLE "inventory_purchase_orders" ADD CONSTRAINT "inventory_purchase_orders_vendor_id_inventory_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."inventory_vendors"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "inventory_pos_status_idx" ON "inventory_purchase_orders" USING btree ("status","created_at");

-- inventory_purchase_order_lines
CREATE TABLE IF NOT EXISTS "inventory_purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"item_id" uuid,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"rate_paise" bigint NOT NULL,
	"received_quantity" integer DEFAULT 0 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_purchase_order_lines_purchase_order_id_inventory_purc' AND conrelid = '"public"."inventory_purchase_order_lines"'::regclass) THEN
    ALTER TABLE "inventory_purchase_order_lines" ADD CONSTRAINT "inventory_purchase_order_lines_purchase_order_id_inventory_purc" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."inventory_purchase_orders"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_purchase_order_lines_item_id_inventory_items_id_fk' AND conrelid = '"public"."inventory_purchase_order_lines"'::regclass) THEN
    ALTER TABLE "inventory_purchase_order_lines" ADD CONSTRAINT "inventory_purchase_order_lines_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "inventory_po_lines_po_idx" ON "inventory_purchase_order_lines" USING btree ("purchase_order_id");

-- inventory_maintenance_tickets
CREATE TABLE IF NOT EXISTS "inventory_maintenance_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"location" text,
	"photo_url" text,
	"status" "inventory_ticket_status" DEFAULT 'open' NOT NULL,
	"raised_by_user_id" uuid NOT NULL,
	"raised_by_name" text NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by_user_id" uuid,
	"resolved_by_name" text,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"resolution_photo_url" text
);
CREATE INDEX IF NOT EXISTS "inventory_tickets_status_idx" ON "inventory_maintenance_tickets" USING btree ("status","raised_at");

-- ════════════════════════════════════════════════════════════════ MIGRATION HISTORY
-- drizzle-kit keeps the list of migrations already applied here. Its rows come with the data export, so that a later
-- "npm run db:migrate" (or the next apply-00xx script) knows 0000-0022 are done and does not replay them.
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
	id SERIAL PRIMARY KEY,
	hash text NOT NULL,
	created_at bigint
);

-- ════════════════════════════════════════════════════════════════ SUPABASE: NO PUBLIC ACCESS
-- Row Level Security stays off (the hub checks every permission itself and connects as the database owner). So that nobody can reach
-- these tables through Supabase's Data API with the public (anon) key, take away the default rights of Supabase's API roles on
-- everything here. Turn the Data API off as well. The hub is not affected. On a database without these roles this does nothing.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;

-- CHECK (should show 48 tables, 14 enums):
-- SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') AS tables,
--        (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public' AND t.typtype = 'e') AS enums;
