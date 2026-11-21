-- Applies migration 0043 (Approvals: watching rules with an expense category) to the live database, by hand. Paste the whole file into the
-- SQL Editor of the database production uses (check DB_DRIVER in Vercel: "pg" means Supabase, otherwise Neon; and use the database
-- DATABASE_URL points to) and run it BEFORE this code is deployed.
--
-- It works whether or not apply-0042 (the watchers table) was run before: it makes the table if it is missing, so you do NOT need to run
-- apply-0042 first. Safe to run more than once; it changes no existing row:
--   - apr_watchers gets a nullable "category" column (the expense category of an Expenditure rule; empty = every category). Every watcher
--     already there keeps watching everything of its form, as before.
--   - the "one row per person per form" index is replaced by "one row per person, form and category", so a person can watch several
--     expense categories.
--   - everything is in one transaction. No hub table is touched.
--   - the code running in production today never reads the new column, so it keeps working, and so does Instant Rollback.
--
-- To undo it (keeps the table and its rows; a person's rules for several categories collapse to one each, so remove those first):
--   DROP INDEX IF EXISTS apr_watchers_rule_uq;
--   ALTER TABLE apr_watchers DROP COLUMN IF EXISTS category;
--   CREATE UNIQUE INDEX IF NOT EXISTS apr_watchers_form_user_uq ON apr_watchers USING btree (form_type, user_id);
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '784661f32545090b5a24b9ec8f966bbe3770ae12cb95e5dca3c4adf84e47553c';

BEGIN;

-- 0042: the table, if it is not there yet.
CREATE TABLE IF NOT EXISTS "apr_watchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_type" text NOT NULL,
	"user_id" uuid NOT NULL,
	"added_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "apr_watchers_user_idx" ON "apr_watchers" USING btree ("user_id");

-- 0043: the category, and one row per person, form and category.
ALTER TABLE "apr_watchers" ADD COLUMN IF NOT EXISTS "category" text;
DROP INDEX IF EXISTS "apr_watchers_form_user_uq";
CREATE UNIQUE INDEX IF NOT EXISTS "apr_watchers_rule_uq" ON "apr_watchers" USING btree ("form_type","user_id",coalesce("category", ''));

-- Records both migrations as applied, so drizzle-kit migrate never runs them again.
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '041ea36f11597025db3b29c870623f6d744f749fa1b0c43df8660943c1c922f9', 1795243878030
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '041ea36f11597025db3b29c870623f6d744f749fa1b0c43df8660943c1c922f9');
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '784661f32545090b5a24b9ec8f966bbe3770ae12cb95e5dca3c4adf84e47553c', 1795246271463
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '784661f32545090b5a24b9ec8f966bbe3770ae12cb95e5dca3c4adf84e47553c');

COMMIT;

-- Afterwards this should return 1, 1 and 1 (the table, its category column, the new index):
-- SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'apr_watchers') AS watchers_table,
--        (SELECT count(*) FROM information_schema.columns WHERE table_name = 'apr_watchers' AND column_name = 'category') AS category_column,
--        (SELECT count(*) FROM pg_indexes WHERE indexname = 'apr_watchers_rule_uq') AS rule_index;
