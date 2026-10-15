-- Applies migration 0008 (hub_org_audit_invites) to the live database, by hand.
-- Paste the whole file into the Neon SQL Editor (project APPHUB) and run it once.
--
-- It only ADDS: new tables, new empty columns, a new application label (default 'active'), indexes. No existing row is changed.
-- It is one transaction: if any statement fails, nothing is applied. The last statement records the migration in Drizzle's log
-- (same hash and timestamp that `npm run db:migrate` would write), so a later `npm run db:migrate` skips it instead of failing.
-- Do NOT run it twice: the second run stops at the first statement ("type already exists"), which is harmless.

BEGIN;

CREATE TYPE "public"."app_status" AS ENUM('active', 'testing', 'unavailable');

CREATE TABLE "access_audit" (
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

CREATE TABLE "app_checks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"app_id" uuid NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_by_id" uuid,
	"ok" boolean NOT NULL,
	"http_status" integer,
	"duration_ms" integer,
	"detail" text NOT NULL
);

CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_name_unique" UNIQUE("name")
);

CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"branch_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_name_unique" UNIQUE("name")
);

CREATE TABLE "user_invites" (
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

ALTER TABLE "apps" ADD COLUMN "status" "app_status" DEFAULT 'active' NOT NULL;

ALTER TABLE "users" ADD COLUMN "branch_id" uuid;

ALTER TABLE "users" ADD COLUMN "team_id" uuid;

ALTER TABLE "users" ADD COLUMN "reporting_manager_id" uuid;

ALTER TABLE "access_audit" ADD CONSTRAINT "access_audit_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "app_checks" ADD CONSTRAINT "app_checks_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "app_checks" ADD CONSTRAINT "app_checks_checked_by_id_users_id_fk" FOREIGN KEY ("checked_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "teams" ADD CONSTRAINT "teams_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "user_invites" ADD CONSTRAINT "user_invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "user_invites" ADD CONSTRAINT "user_invites_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

CREATE INDEX "access_audit_at_idx" ON "access_audit" USING btree ("at");

CREATE INDEX "access_audit_target_idx" ON "access_audit" USING btree ("target_id");

CREATE INDEX "access_audit_actor_idx" ON "access_audit" USING btree ("actor_id");

CREATE INDEX "app_checks_app_idx" ON "app_checks" USING btree ("app_id","checked_at");

CREATE INDEX "teams_branch_idx" ON "teams" USING btree ("branch_id");

CREATE INDEX "user_invites_user_idx" ON "user_invites" USING btree ("user_id");

ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "users" ADD CONSTRAINT "users_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "users" ADD CONSTRAINT "users_reporting_manager_id_users_id_fk" FOREIGN KEY ("reporting_manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;

CREATE INDEX "users_branch_idx" ON "users" USING btree ("branch_id");

CREATE INDEX "users_team_idx" ON "users" USING btree ("team_id");

CREATE INDEX "users_manager_idx" ON "users" USING btree ("reporting_manager_id");

CREATE INDEX "users_department_idx" ON "users" USING btree ("home_department_id");

-- Migration log entry (hash of drizzle/0008_hub_org_audit_invites.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('f561cf52ad1b140c5dbbfe18d75d47517ce246678975fa678a8b4e62f57b5d87', 1792055408744);

COMMIT;

-- Afterwards this should list 9 rows of new things, and the counts should be unchanged (2 users, 12 apps, 6 departments):
-- SELECT 'users.'||column_name FROM information_schema.columns WHERE table_name='users' AND column_name IN ('branch_id','team_id','reporting_manager_id')
-- UNION ALL SELECT 'apps.status' FROM information_schema.columns WHERE table_name='apps' AND column_name='status'
-- UNION ALL SELECT 'table '||table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('branches','teams','user_invites','access_audit','app_checks');
