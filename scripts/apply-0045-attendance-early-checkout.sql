-- Applies migration 0045 (Attendance: early check-out requests) to the live database, by hand. Paste the whole file into the SQL Editor of the
-- database production uses (DB_DRIVER "pg" in Vercel = Supabase, otherwise Neon; the database DATABASE_URL points to) and run it BEFORE the
-- code on feat/attendance-ui is deployed. It needs migration 0044 (scripts/apply-0044-attendance.sql) first: it uses its att_request_status type.
--
-- Safe to run more than once, and it changes no existing row:
--   - one NEW table, att_early_departures (a request to check out before the shift's hours are worked), and its two indexes.
--   - everything is in one transaction.
--   - the code running in production today never reads it, so it keeps working, and so does Instant Rollback.
--
-- The go-live date needs no change here: it is kept in att_settings' existing JSON value (goLiveDate, firstEnabledOn).
--
-- To undo it (throws away every early check-out request):
--   DROP TABLE IF EXISTS att_early_departures;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = 'fadf6902de4e175588d0411371ca7ee8068fad4652f06c24bb07b3a0a0f62a85';

BEGIN;

CREATE TABLE IF NOT EXISTS "att_early_departures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reason" text NOT NULL,
	"status" "att_request_status" DEFAULT 'pending' NOT NULL,
	"approver_id" uuid,
	"decided_by" uuid,
	"approved_at" timestamp with time zone,
	"approver_remark" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "att_early_live_uq" ON "att_early_departures" USING btree ("user_id","date") WHERE status in ('pending', 'approved');
CREATE INDEX IF NOT EXISTS "att_early_status_idx" ON "att_early_departures" USING btree ("status","approver_id");

-- Records the migration as applied, so drizzle-kit migrate never runs it again.
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT 'fadf6902de4e175588d0411371ca7ee8068fad4652f06c24bb07b3a0a0f62a85', 1795261181435
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'fadf6902de4e175588d0411371ca7ee8068fad4652f06c24bb07b3a0a0f62a85');

COMMIT;

-- Afterwards this should return 18 (the att_ tables) and 1:
-- SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'att\_%') AS att_tables,
--        (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'att_early_departures') AS early_table;
