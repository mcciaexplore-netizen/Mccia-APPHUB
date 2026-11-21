-- Applies migration 0042 (Approvals: Watchers) to the live database, by hand. Paste the whole file into the SQL Editor of the database
-- production uses (check DB_DRIVER in Vercel: "pg" means Supabase, otherwise Neon; and use the database DATABASE_URL points to) and run it
-- BEFORE this code is deployed.
--
-- Safe to run more than once, and it changes no existing row:
--   - one NEW, empty table, apr_watchers (prefixed apr_, like every Approval System table): who watches which form (hr, expenditure,
--     budget). No hub table is touched.
--   - everything is in one transaction.
--   - the code running in production today never reads this table, so it keeps working, and so does Instant Rollback.
--
-- To undo it (removes every watcher; nothing else depends on it):
--   DROP TABLE IF EXISTS apr_watchers;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '041ea36f11597025db3b29c870623f6d744f749fa1b0c43df8660943c1c922f9';

BEGIN;

CREATE TABLE IF NOT EXISTS "apr_watchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_type" text NOT NULL,
	"user_id" uuid NOT NULL,
	"added_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "apr_watchers_form_user_uq" ON "apr_watchers" USING btree ("form_type","user_id");
CREATE INDEX IF NOT EXISTS "apr_watchers_user_idx" ON "apr_watchers" USING btree ("user_id");

-- Records the migration as applied, so drizzle-kit migrate never runs it again.
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '041ea36f11597025db3b29c870623f6d744f749fa1b0c43df8660943c1c922f9', 1795243878030
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '041ea36f11597025db3b29c870623f6d744f749fa1b0c43df8660943c1c922f9');

COMMIT;

-- Afterwards this should return 1 and 0 (the table exists, with no watchers yet):
-- SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'apr_watchers') AS watchers_table,
--        (SELECT count(*) FROM apr_watchers) AS watchers;
