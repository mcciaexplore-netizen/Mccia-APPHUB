-- Applies migration 0013 (takes "HR Approval" and "Expenditure Approval" out of the Application access box again) to the live database, by hand.
-- Paste the whole file into the Neon SQL Editor (project APPHUB) and run it once. It does not matter whether it runs before or after the deploy:
-- the new code already leaves these two rows out of the access box and the home page; this only removes them from the database.
--
-- It deletes the two applications added by migration 0012 (their addresses are /approvals/hr/new and /approvals/expenses/new) together with
-- the ticks people had on them, and then the application category "Approval System" if nothing else is in it. Nothing else is touched.
-- One transaction. The last statement records the migration in Drizzle's log.
-- Do NOT run it twice: the second run changes nothing, but the log insert would then be a duplicate.

BEGIN;

DELETE FROM "apps" WHERE "url" IN ('/approvals/hr/new', '/approvals/expenses/new');

DELETE FROM "departments" d
WHERE d."kind" = 'application' AND d."name" = 'Approval System'
  AND NOT EXISTS (SELECT 1 FROM "apps" a WHERE a."department_id" = d."id");

-- Migration log entry (hash of drizzle/0013_remove_approval_app_ticks.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('1d9ba9fb32b526a3f25539e08d0ca4fdcb96ca99ab2518a7ce87abf54c445114', 1792168500315);

COMMIT;

-- Afterwards this should return no rows:
-- SELECT name, url FROM apps WHERE url IN ('/approvals/hr/new', '/approvals/expenses/new');
