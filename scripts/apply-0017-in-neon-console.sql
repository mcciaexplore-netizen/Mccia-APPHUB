-- Applies migration 0017 (the HR Admin and Expense Admin roles, and one person each for Super Admin, HR Admin and Expense Admin) to the live
-- database, by hand. Paste the whole file into the Neon SQL Editor (project APPHUB) and run it once, BEFORE the new code is deployed.
--
-- RUN THE USER CLEAN-UP FIRST (scripts/remove-all-users-except-support-admin.sql): the "one person each" rule below cannot be added while
-- two people still hold the same role (for example two Super Admins left over from testing).
--
-- Part 1 adds two values to the list of roles. Postgres needs these committed before they can be used, so they run on their own, before
-- the transaction. Part 2 adds the "one person each" rule and records the migration in Drizzle's log, in one transaction.
-- Do NOT run it twice: the second run stops at the first statement ("already exists"), which is harmless.

-- Part 1: the two new roles
ALTER TYPE "public"."role" ADD VALUE 'hr_admin';
ALTER TYPE "public"."role" ADD VALUE 'expense_admin';

-- Part 2: one person each, and the log entry
BEGIN;

CREATE UNIQUE INDEX "users_one_super_admin" ON "users" USING btree ("role") WHERE "users"."role" = 'super_admin';
CREATE UNIQUE INDEX "users_one_hr_admin" ON "users" USING btree ("role") WHERE "users"."role" = 'hr_admin';
CREATE UNIQUE INDEX "users_one_expense_admin" ON "users" USING btree ("role") WHERE "users"."role" = 'expense_admin';

-- Migration log entry (hash of drizzle/0017_hr_expense_admin_roles.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('78b692fb2040bebfff5bfef1c2962bc0d1a7eb2865acecd77031d70b6f299da2', 1792171330153);

COMMIT;

-- Afterwards this should list the new roles at the end:
-- SELECT unnest(enum_range(NULL::role));
