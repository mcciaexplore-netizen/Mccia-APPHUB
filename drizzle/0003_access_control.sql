CREATE TYPE "public"."activity_action" AS ENUM('login', 'launch');--> statement-breakpoint
CREATE TABLE "access_template_apps" (
	"template_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	CONSTRAINT "access_template_apps_template_id_app_id_pk" PRIMARY KEY("template_id","app_id")
);
--> statement-breakpoint
CREATE TABLE "access_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_templates_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"ip_address" text,
	"success" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_app_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	"granted_by_id" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_app_access_user_app_uq" UNIQUE("user_id","app_id")
);
--> statement-breakpoint
ALTER TABLE "activity_log" ALTER COLUMN "department_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN "action" "activity_action" DEFAULT 'launch' NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN "ip_address" text;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "app_token" text;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "designation" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "access_template_apps" ADD CONSTRAINT "access_template_apps_template_id_access_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."access_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_template_apps" ADD CONSTRAINT "access_template_apps_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_app_access" ADD CONSTRAINT "user_app_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_app_access" ADD CONSTRAINT "user_app_access_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_app_access" ADD CONSTRAINT "user_app_access_granted_by_id_users_id_fk" FOREIGN KEY ("granted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_attempts_email_idx" ON "login_attempts" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_idx" ON "login_attempts" USING btree ("ip_address","created_at");--> statement-breakpoint
CREATE INDEX "user_app_access_app_idx" ON "user_app_access" USING btree ("app_id");--> statement-breakpoint
UPDATE "departments" SET "slug" = lower(trim(both '-' from regexp_replace("name", '[^a-zA-Z0-9]+', '-', 'g'))) WHERE "slug" IS NULL;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_slug_unique" UNIQUE("slug");