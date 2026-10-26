ALTER TYPE "public"."role" ADD VALUE 'hr_admin';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'expense_admin';--> statement-breakpoint
CREATE UNIQUE INDEX "users_one_super_admin" ON "users" USING btree ("role") WHERE "users"."role" = 'super_admin';--> statement-breakpoint
CREATE UNIQUE INDEX "users_one_hr_admin" ON "users" USING btree ("role") WHERE "users"."role" = 'hr_admin';--> statement-breakpoint
CREATE UNIQUE INDEX "users_one_expense_admin" ON "users" USING btree ("role") WHERE "users"."role" = 'expense_admin';