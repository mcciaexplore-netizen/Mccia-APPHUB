-- Applies migration 0048 ("Forgot password?" links) to the live database, by hand. Paste the whole file into the SQL Editor of the database
-- production uses (DB_DRIVER "pg" in Vercel = Supabase, otherwise Neon; the database DATABASE_URL points to) and run it BEFORE the code on
-- feat/password-reset is deployed.
--
-- Safe to run more than once, and it changes no existing table or row:
--   - one NEW table, hub_password_reset_tokens: one row per reset link emailed (the SHA-256 of the link's secret, never the secret; the
--     person, linked to users: if they are deleted, their links go too; when it expires).
--   - one index on it (by person).
--   - everything is in one transaction.
--   - the code running in production today never reads the new table, so it keeps working, and so does Instant Rollback.
--
-- To undo it (every reset link already emailed stops working):
--   DROP TABLE IF EXISTS hub_password_reset_tokens;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = 'ad1201d7ba733175e10aca7a2e8b40371411244210181f0e5697ee8aa6caa234';

BEGIN;

CREATE TABLE IF NOT EXISTS "hub_password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_password_reset_tokens_token_unique" UNIQUE("token")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hub_password_reset_tokens_user_id_users_id_fk') THEN
    ALTER TABLE "hub_password_reset_tokens" ADD CONSTRAINT "hub_password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "hub_password_reset_tokens_user_idx" ON "hub_password_reset_tokens" USING btree ("user_id");

-- Records the migration as applied, so drizzle-kit migrate never runs it again.
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT 'ad1201d7ba733175e10aca7a2e8b40371411244210181f0e5697ee8aa6caa234', 1795429078361
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'ad1201d7ba733175e10aca7a2e8b40371411244210181f0e5697ee8aa6caa234');

COMMIT;

-- Afterwards this should return 1, 2, 1 and 1:
-- SELECT (SELECT count(*) FROM information_schema.tables WHERE table_name = 'hub_password_reset_tokens') AS new_table,
--        (SELECT count(*) FROM pg_constraint WHERE conname IN ('hub_password_reset_tokens_token_unique', 'hub_password_reset_tokens_user_id_users_id_fk')) AS constraints,
--        (SELECT count(*) FROM pg_indexes WHERE indexname = 'hub_password_reset_tokens_user_idx') AS index_by_person,
--        (SELECT count(*) FROM drizzle.__drizzle_migrations WHERE hash = 'ad1201d7ba733175e10aca7a2e8b40371411244210181f0e5697ee8aa6caa234') AS recorded;
