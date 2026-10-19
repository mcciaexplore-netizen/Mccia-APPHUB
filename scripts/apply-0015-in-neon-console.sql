-- Applies migration 0015 (expenses no longer need a branch) to the live database, by hand.
-- Paste the whole file into the Neon SQL Editor (project APPHUB) and run it once, BEFORE the new code is deployed.
--
-- It only lets the branch of an expense be empty (new expenses are saved without one). Requests that already have a branch keep it.
-- Nothing is deleted. One transaction. The last statement records the migration in Drizzle's log.
-- Do NOT run it twice: the second run changes nothing, but the log insert would then be a duplicate.

BEGIN;

ALTER TABLE "apr_expenditure_details" ALTER COLUMN "branch_id" DROP NOT NULL;

-- Migration log entry (hash of drizzle/0015_expense_branch_optional.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('6e6fe4212c970d0a8e17dc7c0229abe00bdeff9f2b23dd3cbb6f5d8c2d80afa1', 1792171328153);

COMMIT;

-- Afterwards this should say YES (the column may be empty):
-- SELECT is_nullable FROM information_schema.columns WHERE table_name = 'apr_expenditure_details' AND column_name = 'branch_id';
