-- Applies migration 0046 (Attendance: phone notifications, Web Push subscriptions) to the live database, by hand. Paste the whole file into the
-- SQL Editor of the database production uses (DB_DRIVER "pg" in Vercel = Supabase, otherwise Neon; the database DATABASE_URL points to) and
-- run it BEFORE the code on feat/attendance-pwa is deployed. It needs 0044 and 0045 (scripts/apply-0044-…, apply-0045-…) first.
--
-- Safe to run more than once, and it changes no existing row:
--   - one NEW table, att_push_subscriptions (the browsers that turned Attendance notifications on), and its two indexes.
--   - everything is in one transaction.
--   - the code running in production today never reads it, so it keeps working, and so does Instant Rollback.
--
-- Notifications also need ATT_VAPID_PUBLIC_KEY and ATT_VAPID_PRIVATE_KEY in Vercel (from `node scripts/att-vapid-keygen.mjs`). Without them
-- nothing is sent and the "Notifications on this device" card is hidden; the table can still be created now.
--
-- To undo it (forgets every device that turned notifications on):
--   DROP TABLE IF EXISTS att_push_subscriptions;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '96192fb01485866f1d8a4bad82a3b79d5c3f085b7e5d7319d8161dfe11d6fdc4';

BEGIN;

CREATE TABLE IF NOT EXISTS "att_push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text DEFAULT '' NOT NULL,
	"auth" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "att_push_endpoint_uq" ON "att_push_subscriptions" USING btree ("endpoint");
CREATE INDEX IF NOT EXISTS "att_push_user_idx" ON "att_push_subscriptions" USING btree ("user_id");

-- Records the migration as applied, so drizzle-kit migrate never runs it again.
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '96192fb01485866f1d8a4bad82a3b79d5c3f085b7e5d7319d8161dfe11d6fdc4', 1795410702318
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '96192fb01485866f1d8a4bad82a3b79d5c3f085b7e5d7319d8161dfe11d6fdc4');

COMMIT;

-- Afterwards this should return 19 (the att_ tables) and 1:
-- SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'att\_%') AS att_tables,
--        (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'att_push_subscriptions') AS push_table;
