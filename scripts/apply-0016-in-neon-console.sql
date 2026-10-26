-- Applies migration 0016 (budgets per expense category, set by the Director General) to the live database, by hand.
-- Paste the whole file into the Neon SQL Editor (project APPHUB) and run it once, BEFORE the new code is deployed.
--
-- It ADDS one empty table, apr_category_budgets: the budget of each expense category for each financial year. Nothing existing is changed
-- or deleted. One transaction. The last statement records the migration in Drizzle's log.
-- Do NOT run it twice: the second run stops at the first statement ("already exists"), which is harmless.

BEGIN;

CREATE TABLE "apr_category_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"financial_year" text NOT NULL,
	"category_id" uuid NOT NULL,
	"allocated_paise" bigint NOT NULL,
	"updated_by_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apr_category_budgets_fy_category_uq" UNIQUE("financial_year","category_id")
);
ALTER TABLE "apr_category_budgets" ADD CONSTRAINT "apr_category_budgets_category_id_apr_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."apr_categories"("id") ON DELETE restrict ON UPDATE no action;

-- Migration log entry (hash of drizzle/0016_category_budgets.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('8e564b31fa56eb62f7ba14960f2d6db8c304d3dfdb7053edb549b736cdf6a5dd', 1792171329153);

COMMIT;

-- Afterwards this should return 0 (the table exists and is empty until budgets are set):
-- SELECT count(*) FROM apr_category_budgets;
