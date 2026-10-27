ALTER TABLE "apps" ADD COLUMN "sso_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "sso_slug" text;--> statement-breakpoint
ALTER TABLE "apps" ADD COLUMN "sso_callback_url" text;--> statement-breakpoint
ALTER TABLE "user_app_access" ADD COLUMN "app_role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "apps_sso_slug_uq" ON "apps" USING btree ("sso_slug") WHERE "apps"."sso_slug" is not null;--> statement-breakpoint
ALTER TABLE "user_app_access" ADD CONSTRAINT "user_app_access_app_role_check" CHECK ("user_app_access"."app_role" in ('user', 'admin'));