-- Applies migration 0047 (Approvals: watch every request from one person) to the live database, by hand. Paste the whole file into the SQL
-- Editor of the database production uses (DB_DRIVER "pg" in Vercel = Supabase, otherwise Neon; the database DATABASE_URL points to) and run it
-- BEFORE the code on feat/approvals-watch-user is deployed. It needs the watchers migrations first (apply-0042, apply-0043).
--
-- Safe to run more than once, and it changes no existing row:
--   - apr_watchers.form_type may now be empty (a "by user" rule has no type); every existing rule keeps its type.
--   - one NEW column, apr_watchers.watched_user_id (the person watched), linked to users: if that person is deleted, the rule goes too.
--   - one unique index (a person is watched once per watcher), one plain index, and one check: a rule is EITHER a type (with or without a
--     category) OR a person, never both.
--   - everything is in one transaction.
--   - the code running in production today never writes the new column, so it keeps working, and so does Instant Rollback.
--
-- To undo it (throws away every "by user" rule):
--   DELETE FROM apr_watchers WHERE watched_user_id IS NOT NULL;
--   ALTER TABLE apr_watchers DROP CONSTRAINT IF EXISTS apr_watchers_one_kind;
--   ALTER TABLE apr_watchers DROP COLUMN IF EXISTS watched_user_id;
--   ALTER TABLE apr_watchers ALTER COLUMN form_type SET NOT NULL;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = 'cb2ee5eb1f061db4dce5f1c5a367d73d6f6f887a92e00222888bef0f9e1d1630';

BEGIN;

ALTER TABLE "apr_watchers" ALTER COLUMN "form_type" DROP NOT NULL;
ALTER TABLE "apr_watchers" ADD COLUMN IF NOT EXISTS "watched_user_id" uuid;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apr_watchers_watched_user_id_users_id_fk') THEN
    ALTER TABLE "apr_watchers" ADD CONSTRAINT "apr_watchers_watched_user_id_users_id_fk" FOREIGN KEY ("watched_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "apr_watchers_user_rule_uq" ON "apr_watchers" USING btree ("user_id","watched_user_id") WHERE watched_user_id is not null;
CREATE INDEX IF NOT EXISTS "apr_watchers_watched_idx" ON "apr_watchers" USING btree ("watched_user_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apr_watchers_one_kind') THEN
    ALTER TABLE "apr_watchers" ADD CONSTRAINT "apr_watchers_one_kind" CHECK ((form_type is not null and watched_user_id is null) or (form_type is null and watched_user_id is not null and category is null));
  END IF;
END $$;

-- Records the migration as applied, so drizzle-kit migrate never runs it again.
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT 'cb2ee5eb1f061db4dce5f1c5a367d73d6f6f887a92e00222888bef0f9e1d1630', 1795417247505
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'cb2ee5eb1f061db4dce5f1c5a367d73d6f6f887a92e00222888bef0f9e1d1630');

COMMIT;

-- Afterwards this should return 1, 1, 2 and 0:
-- SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name = 'apr_watchers' AND column_name = 'watched_user_id') AS new_column,
--        (SELECT count(*) FROM information_schema.columns WHERE table_name = 'apr_watchers' AND column_name = 'form_type' AND is_nullable = 'YES') AS type_optional,
--        (SELECT count(*) FROM pg_constraint WHERE conname IN ('apr_watchers_one_kind', 'apr_watchers_watched_user_id_users_id_fk')) AS constraints,
--        (SELECT count(*) FROM apr_watchers WHERE form_type IS NULL) AS rules_without_type;
