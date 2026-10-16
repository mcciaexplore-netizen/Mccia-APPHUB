DELETE FROM "apps" WHERE "url" IN ('/approvals/hr/new', '/approvals/expenses/new');--> statement-breakpoint
DELETE FROM "departments" d
WHERE d."kind" = 'application' AND d."name" = 'Approval System'
  AND NOT EXISTS (SELECT 1 FROM "apps" a WHERE a."department_id" = d."id");
