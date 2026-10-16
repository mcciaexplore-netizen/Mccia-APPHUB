-- Applies migration 0012 (HR Approval and Expenditure Approval become two applications you can tick for a person) to the live database, by hand.
-- Paste the whole file into the Neon SQL Editor (project APPHUB) and run it once, BEFORE the new code is deployed.
--
-- It only ADDS and gives. It makes sure the application category "Approval System" exists; the old single "Approvals" card (if there is one)
-- becomes "HR Approval" and "Expenditure Approval" is added next to it; then every ACTIVE person gets both ticked, so nobody loses what they have
-- today (until now everyone could raise requests). From then on a person added later gets neither until the Support Admin ticks it on their profile.
-- People with approval duties (first approvers, the DG, viewers, the Approvals admin) open both applications whatever is ticked.
-- Nothing else is changed or removed. It is one transaction: if any statement fails, nothing is applied. The last statement records the
-- migration in Drizzle's log (the same hash and timestamp `npm run db:migrate` would write).
-- Do NOT run it twice: the second run changes nothing (every statement checks first), but the log insert would then be a duplicate.

BEGIN;

INSERT INTO "departments" ("kind", "name", "slug", "icon", "sort_order")
SELECT 'application', 'Approval System', 'approval-system', 'ClipboardList', COALESCE((SELECT max("sort_order") FROM "departments" WHERE "kind" = 'application'), 0) + 10
WHERE NOT EXISTS (SELECT 1 FROM "departments" WHERE "kind" = 'application' AND "name" = 'Approval System')
  AND NOT EXISTS (SELECT 1 FROM "apps" WHERE "url" ~ '^(https?://[^/?#]+)?/approvals/?$' OR "url" IN ('/approvals/hr/new', '/approvals/expenses/new'))
ON CONFLICT DO NOTHING;

UPDATE "apps" SET "name" = 'HR Approval', "url" = '/approvals/hr/new', "description" = 'HR requests, and expenditure of the threshold and above', "icon" = 'UserCheck', "sort_order" = 10
WHERE "id" = (SELECT "id" FROM "apps" WHERE "url" ~ '^(https?://[^/?#]+)?/approvals/?$' ORDER BY "created_at", "id" LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM "apps" WHERE "url" = '/approvals/hr/new');

INSERT INTO "apps" ("department_id", "name", "description", "url", "icon", "sort_order")
SELECT d."id", 'HR Approval', 'HR requests, and expenditure of the threshold and above', '/approvals/hr/new', 'UserCheck', 10
FROM "departments" d
WHERE d."kind" = 'application' AND d."name" = 'Approval System'
  AND NOT EXISTS (SELECT 1 FROM "apps" WHERE "url" = '/approvals/hr/new')
LIMIT 1;

INSERT INTO "apps" ("department_id", "name", "description", "url", "icon", "sort_order")
SELECT h."department_id", 'Expenditure Approval', 'Expenses below the threshold', '/approvals/expenses/new', 'Wallet', 20
FROM "apps" h
WHERE h."url" = '/approvals/hr/new'
  AND NOT EXISTS (SELECT 1 FROM "apps" WHERE "url" = '/approvals/expenses/new')
LIMIT 1;

INSERT INTO "user_app_access" ("user_id", "app_id")
SELECT u."id", a."id"
FROM "users" u CROSS JOIN "apps" a
WHERE u."is_active" = true AND a."url" IN ('/approvals/hr/new', '/approvals/expenses/new')
ON CONFLICT ("user_id", "app_id") DO NOTHING;

-- Migration log entry (hash of drizzle/0012_approval_apps.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('0e75943e5d001c48869b9a3e3b7d8793bf7db63e7ee86484f0a948a167704284', 1792155644492);

COMMIT;

-- Afterwards this should list the two applications, in the Approval System category, each with every active person ticked:
-- SELECT a.name, a.url, d.name AS category, (SELECT count(*) FROM user_app_access x WHERE x.app_id = a.id) AS people
-- FROM apps a JOIN departments d ON d.id = a.department_id WHERE a.url IN ('/approvals/hr/new', '/approvals/expenses/new');
