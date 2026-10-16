-- Applies migration 0014 (the Approval Forms editor, and no more organisation departments) to the live database, by hand.
-- Paste the whole file into the Neon SQL Editor (project APPHUB) and run it once, BEFORE the new code is deployed.
--
-- It ADDS a table for the form settings (apr_form_fields) and a column for the answers to extra fields (apr_requests.custom_values, empty for
-- every request that exists today). It also DELETES the organisation departments (Finance, IT, AI, ERU, Defense, CBP, Graphics and any you
-- made) after clearing the department on every person who had one. The application categories that group the hub's applications are NOT
-- touched. It is one transaction: if any statement fails, nothing is applied. The last statement records the migration in Drizzle's log.
-- Do NOT run it twice: the second run stops at the first statement ("already exists"), which is harmless.

BEGIN;

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


ALTER TABLE "apr_requests" ADD COLUMN "custom_values" jsonb DEFAULT '[]'::jsonb NOT NULL;


UPDATE "users" SET "home_department_id" = NULL WHERE "home_department_id" IN (SELECT "id" FROM "departments" WHERE "kind" = 'organisation');

DELETE FROM "departments" WHERE "kind" = 'organisation';

-- Migration log entry (hash of drizzle/0014_form_fields_and_departments.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('4207a411f8bf84afd34c64c50ba4c1d7721c30ad03d905c7e6b7a8c212e331e3', 1792171327153);

COMMIT;

-- Afterwards these should show no organisation departments, and the new table:
-- SELECT kind, count(*) FROM departments GROUP BY kind;
-- SELECT count(*) FROM apr_form_fields;
