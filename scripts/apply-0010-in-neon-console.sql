-- Applies migration 0010 (roles: Super Admin and Admin, with the areas an Admin may open) to the live database, by hand.
-- Paste the whole file into the Neon SQL Editor (project APPHUB) and run it once, BEFORE the new code is deployed.
--
-- It only ADDS: two new role values ("super_admin" and "admin") and one new column on users, admin_areas, empty for everyone.
-- No existing row is changed: everyone keeps the role they have today (your main admin stays head_admin, now shown as "Support admin").
-- It is one transaction: if any statement fails, nothing is applied. The last statement records the migration in Drizzle's log
-- (same hash and timestamp that `npm run db:migrate` would write), so a later `npm run db:migrate` skips it instead of failing.
-- Do NOT run it twice: the second run stops at the first statement ("already exists"), which is harmless.

BEGIN;

ALTER TYPE "public"."role" ADD VALUE 'super_admin';

ALTER TYPE "public"."role" ADD VALUE 'admin';

ALTER TABLE "users" ADD COLUMN "admin_areas" text[] DEFAULT '{}'::text[] NOT NULL;

-- Migration log entry (hash of drizzle/0010_roles_super_admin_admin.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('ff3ad8ca496a04b54fc96efcd6dc7db3ee87450cad560e728739ba49f7198701', 1792127634760);

COMMIT;

-- Afterwards this should return 3 rows, and the number of users and their roles should be unchanged:
-- SELECT 'column '||column_name FROM information_schema.columns WHERE table_name='users' AND column_name='admin_areas'
-- UNION ALL SELECT 'role '||enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='role' AND enumlabel IN ('super_admin','admin');
