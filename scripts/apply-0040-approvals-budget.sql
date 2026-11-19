-- Applies migration 0040 (Approvals: the Budget Approval form and budget revisions) to the live database, by hand. Paste the whole file
-- into the SQL Editor of the database production uses (check DB_DRIVER in Vercel: "pg" means Supabase, otherwise Neon; and use the database
-- DATABASE_URL points to) and run it BEFORE this code is deployed.
--
-- Safe to run more than once, and it changes no existing row:
--   - one new value, 'budget', on the request type apr_request_type (the existing HR and expenditure values are untouched);
--   - three new, empty, nullable columns on apr_requests: budget_details (the event, income and vendors, as JSON), parent_request_id (a
--     revision points at the budget it revises) and revision_no (1, 2, 3...); every existing request keeps them empty;
--   - an index and a unique constraint on those columns, and a partial unique index that allows at most one open revision per budget.
--   - no new table. The code running in production today never reads these columns, so it keeps working, and so does Instant Rollback.
--
-- To undo it (only before any budget request exists; a type value cannot be removed while rows use it):
--   ALTER TABLE apr_requests DROP CONSTRAINT IF EXISTS apr_requests_parent_revision_uq;
--   DROP INDEX IF EXISTS apr_requests_one_open_revision_uq, apr_requests_parent_idx;
--   ALTER TABLE apr_requests DROP COLUMN IF EXISTS budget_details, DROP COLUMN IF EXISTS parent_request_id, DROP COLUMN IF EXISTS revision_no;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '58b5a313afe8bfdec8db133528c324f7dc9c455c808f819da7f20a86e6623c9c';
--   (the 'budget' value stays on the type; it is harmless.)

BEGIN;

-- Postgres 12 and later allow this inside a transaction; the new value is not used in this script.
ALTER TYPE "public"."apr_request_type" ADD VALUE IF NOT EXISTS 'budget';

ALTER TABLE "apr_requests" ADD COLUMN IF NOT EXISTS "budget_details" jsonb;
ALTER TABLE "apr_requests" ADD COLUMN IF NOT EXISTS "parent_request_id" uuid;
ALTER TABLE "apr_requests" ADD COLUMN IF NOT EXISTS "revision_no" integer;

CREATE INDEX IF NOT EXISTS "apr_requests_parent_idx" ON "apr_requests" USING btree ("parent_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "apr_requests_one_open_revision_uq" ON "apr_requests" USING btree ("parent_request_id")
  WHERE "apr_requests"."parent_request_id" is not null and "apr_requests"."status" in ('draft', 'pending');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apr_requests_parent_revision_uq') THEN
    ALTER TABLE "apr_requests" ADD CONSTRAINT "apr_requests_parent_revision_uq" UNIQUE ("parent_request_id", "revision_no");
  END IF;
END
$$;

-- Records the migration as applied, so drizzle-kit migrate never runs it again.
CREATE SCHEMA IF NOT EXISTS drizzle;
CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '58b5a313afe8bfdec8db133528c324f7dc9c455c808f819da7f20a86e6623c9c', 1795069291449
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '58b5a313afe8bfdec8db133528c324f7dc9c455c808f819da7f20a86e6623c9c');

COMMIT;

-- Afterwards this should return true, 3 and 2:
-- SELECT 'budget' = ANY (enum_range(NULL::apr_request_type)::text[]) AS budget_type,
--        (SELECT count(*) FROM information_schema.columns WHERE table_name = 'apr_requests' AND column_name IN ('budget_details', 'parent_request_id', 'revision_no')) AS new_columns,
--        (SELECT count(*) FROM pg_indexes WHERE tablename = 'apr_requests' AND indexname IN ('apr_requests_parent_idx', 'apr_requests_one_open_revision_uq')) AS new_indexes;
