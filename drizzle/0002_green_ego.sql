ALTER TABLE "activity_log" DROP CONSTRAINT "activity_log_app_id_apps_id_fk";
--> statement-breakpoint
ALTER TABLE "activity_log" ALTER COLUMN "app_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE set null ON UPDATE no action;