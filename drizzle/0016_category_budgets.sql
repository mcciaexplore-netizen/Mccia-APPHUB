CREATE TABLE "apr_category_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"financial_year" text NOT NULL,
	"category_id" uuid NOT NULL,
	"allocated_paise" bigint NOT NULL,
	"updated_by_name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apr_category_budgets_fy_category_uq" UNIQUE("financial_year","category_id")
);
--> statement-breakpoint
ALTER TABLE "apr_category_budgets" ADD CONSTRAINT "apr_category_budgets_category_id_apr_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."apr_categories"("id") ON DELETE restrict ON UPDATE no action;