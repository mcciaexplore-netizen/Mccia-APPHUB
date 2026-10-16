CREATE TABLE "apr_form_fields" (
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
--> statement-breakpoint
ALTER TABLE "apr_requests" ADD COLUMN "custom_values" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
UPDATE "users" SET "home_department_id" = NULL WHERE "home_department_id" IN (SELECT "id" FROM "departments" WHERE "kind" = 'organisation');--> statement-breakpoint
DELETE FROM "departments" WHERE "kind" = 'organisation';
