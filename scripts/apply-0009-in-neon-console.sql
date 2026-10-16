-- Applies migration 0009 (approvals: return for corrections, HR budget) to the live database, by hand.
-- Paste the whole file into the Neon SQL Editor (project APPHUB) and run it once, BEFORE the new code is deployed.
--
-- It only ADDS: three new values on existing status lists ("returned"), and five new empty columns on apr_hr_details with two
-- foreign keys. No existing row is changed, and every existing request keeps working exactly as before.
-- It is one transaction: if any statement fails, nothing is applied. The last statement records the migration in Drizzle's log
-- (same hash and timestamp that `npm run db:migrate` would write), so a later `npm run db:migrate` skips it instead of failing.
-- Do NOT run it twice: the second run stops at the first statement ("already exists"), which is harmless.

BEGIN;

ALTER TYPE "public"."apr_event_action" ADD VALUE 'returned';

ALTER TYPE "public"."apr_request_status" ADD VALUE 'returned';

ALTER TYPE "public"."apr_step_status" ADD VALUE 'returned';

ALTER TABLE "apr_hr_details" ADD COLUMN "branch_id" uuid;

ALTER TABLE "apr_hr_details" ADD COLUMN "budget_category_id" uuid;

ALTER TABLE "apr_hr_details" ADD COLUMN "budget_allocated_paise" bigint;

ALTER TABLE "apr_hr_details" ADD COLUMN "budget_available_paise" bigint;

ALTER TABLE "apr_hr_details" ADD COLUMN "budget_remaining_paise" bigint;

ALTER TABLE "apr_hr_details" ADD CONSTRAINT "apr_hr_details_branch_id_apr_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."apr_branches"("id") ON DELETE restrict ON UPDATE no action;

ALTER TABLE "apr_hr_details" ADD CONSTRAINT "apr_hr_details_budget_category_id_apr_categories_id_fk" FOREIGN KEY ("budget_category_id") REFERENCES "public"."apr_categories"("id") ON DELETE restrict ON UPDATE no action;

-- Migration log entry (hash of drizzle/0009_approvals_return_hr_budget.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('42d16280a336abee6a2dd93ff9e529f2caf0192f55ac406f43fb9b0913514583', 1792070966243);

COMMIT;

-- Afterwards this should return 5 rows for the columns and 3 rows with the new value, and the request counts should be unchanged:
-- SELECT 'column '||column_name FROM information_schema.columns WHERE table_name='apr_hr_details' AND column_name IN ('branch_id','budget_category_id','budget_allocated_paise','budget_available_paise','budget_remaining_paise')
-- UNION ALL SELECT 'value '||t.typname FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid WHERE e.enumlabel='returned';
