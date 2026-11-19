-- Applies migration 0041 (Approvals: the Budget form's Department list) to the live database, by hand. Paste the whole file into the SQL
-- Editor of the database production uses (check DB_DRIVER in Vercel: "pg" means Supabase, otherwise Neon; and use the database DATABASE_URL
-- points to) and run it BEFORE this code is deployed. Migration 0040 (scripts/apply-0040-approvals-budget.sql) must already be applied.
--
-- Safe to run more than once, and it changes no existing row:
--   - one NEW table, apr_departments (prefixed apr_, like every Approval System table). No hub table is touched: the hub's own departments
--     are only read, and shown beside these on the form.
--   - ten departments to start with (Finance, HR, Operations, Marketing, IT / AI Studio, Administration, Membership, Events, Research (ERU),
--     Design Team); any already there are left as they are.
--   - everything is in one transaction.
--   - the code running in production today never reads this table, so it keeps working, and so does Instant Rollback.
--
-- To undo it (throws away the Approval System's department list; budgets keep the department name they were raised with):
--   DROP TABLE IF EXISTS apr_departments;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '0fb7bd252f8dcf2a980f380a42787ec04c9c80c2aadcd875c63eb4e4302b8f88';

BEGIN;

CREATE TABLE IF NOT EXISTS "apr_departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "apr_departments_name_uq" ON "apr_departments" USING btree (lower("name"));

INSERT INTO "apr_departments" ("name", "sort") VALUES
	('Finance', 10), ('HR', 20), ('Operations', 30), ('Marketing', 40), ('IT / AI Studio', 50),
	('Administration', 60), ('Membership', 70), ('Events', 80), ('Research (ERU)', 90), ('Design Team', 100)
ON CONFLICT DO NOTHING;

-- Records the migration as applied, so drizzle-kit migrate never runs it again.
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '0fb7bd252f8dcf2a980f380a42787ec04c9c80c2aadcd875c63eb4e4302b8f88', 1795073756609
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '0fb7bd252f8dcf2a980f380a42787ec04c9c80c2aadcd875c63eb4e4302b8f88');

COMMIT;

-- Afterwards this should return 1 and at least 10:
-- SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'apr_departments') AS departments_table,
--        (SELECT count(*) FROM apr_departments) AS departments;
