INSERT INTO "departments" ("kind", "name", "slug", "icon", "sort_order")
SELECT 'application', 'Approval System', 'approval-system', 'ClipboardList', COALESCE((SELECT max("sort_order") FROM "departments" WHERE "kind" = 'application'), 0) + 10
WHERE NOT EXISTS (SELECT 1 FROM "departments" WHERE "kind" = 'application' AND "name" = 'Approval System')
  AND NOT EXISTS (SELECT 1 FROM "apps" WHERE "url" ~ '^(https?://[^/?#]+)?/approvals/?$' OR "url" IN ('/approvals/hr/new', '/approvals/expenses/new'))
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "apps" SET "name" = 'HR Approval', "url" = '/approvals/hr/new', "description" = 'HR requests, and expenditure of the threshold and above', "icon" = 'UserCheck', "sort_order" = 10
WHERE "id" = (SELECT "id" FROM "apps" WHERE "url" ~ '^(https?://[^/?#]+)?/approvals/?$' ORDER BY "created_at", "id" LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM "apps" WHERE "url" = '/approvals/hr/new');--> statement-breakpoint
INSERT INTO "apps" ("department_id", "name", "description", "url", "icon", "sort_order")
SELECT d."id", 'HR Approval', 'HR requests, and expenditure of the threshold and above', '/approvals/hr/new', 'UserCheck', 10
FROM "departments" d
WHERE d."kind" = 'application' AND d."name" = 'Approval System'
  AND NOT EXISTS (SELECT 1 FROM "apps" WHERE "url" = '/approvals/hr/new')
LIMIT 1;--> statement-breakpoint
INSERT INTO "apps" ("department_id", "name", "description", "url", "icon", "sort_order")
SELECT h."department_id", 'Expenditure Approval', 'Expenses below the threshold', '/approvals/expenses/new', 'Wallet', 20
FROM "apps" h
WHERE h."url" = '/approvals/hr/new'
  AND NOT EXISTS (SELECT 1 FROM "apps" WHERE "url" = '/approvals/expenses/new')
LIMIT 1;--> statement-breakpoint
INSERT INTO "user_app_access" ("user_id", "app_id")
SELECT u."id", a."id"
FROM "users" u CROSS JOIN "apps" a
WHERE u."is_active" = true AND a."url" IN ('/approvals/hr/new', '/approvals/expenses/new')
ON CONFLICT ("user_id", "app_id") DO NOTHING;
