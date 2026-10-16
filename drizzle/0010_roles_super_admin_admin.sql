ALTER TYPE "public"."role" ADD VALUE 'super_admin';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'admin';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "admin_areas" text[] DEFAULT '{}'::text[] NOT NULL;