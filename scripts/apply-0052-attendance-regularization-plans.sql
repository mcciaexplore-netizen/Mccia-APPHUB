-- Applies migration 0052 (Attendance: planned working days, a day ahead planned with its check-in and check-out times and approved like a
-- regularization) to the live database, by hand. Paste the whole file into the SQL Editor of the database production uses (DB_DRIVER "pg"
-- in Vercel = Supabase, otherwise Neon; the database DATABASE_URL points to) and run it BEFORE the code on
-- feat/attendance-regularization-v2 is deployed. It needs migration 0044 first (scripts/apply-0044-attendance.sql): it changes its
-- att_regularization_requests table.
--
-- Safe to run more than once, and it changes no existing row:
--   - four NEW columns on att_regularization_requests: is_future (false for every existing row), planned_date, planned_checkin and
--     planned_checkout (empty for every existing row);
--   - the "one live request per person and day" index is rebuilt to be one live correction AND one live plan per person and day. Every
--     existing row has is_future = false, so it allows exactly what it allowed before;
--   - everything is in one transaction.
--   - the code running in production today never reads these columns and only writes is_future = false rows, so it keeps working, and so
--     does Instant Rollback.
--
-- To undo it (throws away any planned days made since):
--   BEGIN;
--   DELETE FROM att_regularization_requests WHERE is_future;
--   DROP INDEX IF EXISTS att_regularization_live_uq;
--   CREATE UNIQUE INDEX att_regularization_live_uq ON att_regularization_requests USING btree (user_id, date) WHERE status in ('pending', 'approved');
--   ALTER TABLE att_regularization_requests DROP COLUMN IF EXISTS is_future, DROP COLUMN IF EXISTS planned_date,
--     DROP COLUMN IF EXISTS planned_checkin, DROP COLUMN IF EXISTS planned_checkout;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '5db1ffadb4c5df58debc213fc758fda90cb7bedbcf1a5c138b80338430bc262b';
--   COMMIT;

BEGIN;

ALTER TABLE "att_regularization_requests" ADD COLUMN IF NOT EXISTS "is_future" boolean DEFAULT false NOT NULL;
ALTER TABLE "att_regularization_requests" ADD COLUMN IF NOT EXISTS "planned_date" date;
ALTER TABLE "att_regularization_requests" ADD COLUMN IF NOT EXISTS "planned_checkin" time;
ALTER TABLE "att_regularization_requests" ADD COLUMN IF NOT EXISTS "planned_checkout" time;

DROP INDEX IF EXISTS "att_regularization_live_uq";
CREATE UNIQUE INDEX "att_regularization_live_uq" ON "att_regularization_requests" USING btree ("user_id","date","is_future") WHERE status in ('pending', 'approved');

-- Records the migration as applied, so drizzle-kit migrate never runs it again.
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '5db1ffadb4c5df58debc213fc758fda90cb7bedbcf1a5c138b80338430bc262b', 1795603306985
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '5db1ffadb4c5df58debc213fc758fda90cb7bedbcf1a5c138b80338430bc262b');

COMMIT;

-- Afterwards this should return 4 (the new columns) and 3 (the index's columns: user_id, date, is_future):
-- SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'att_regularization_requests'
--           AND column_name IN ('is_future', 'planned_date', 'planned_checkin', 'planned_checkout')) AS new_columns,
--        (SELECT array_length(indkey::int2[], 1) FROM pg_index WHERE indexrelid = 'public.att_regularization_live_uq'::regclass) AS index_columns;
