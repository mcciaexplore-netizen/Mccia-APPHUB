ALTER TYPE "public"."apr_event_action" ADD VALUE 'returned';--> statement-breakpoint
ALTER TYPE "public"."apr_request_status" ADD VALUE 'returned';--> statement-breakpoint
ALTER TYPE "public"."apr_step_status" ADD VALUE 'returned';--> statement-breakpoint
ALTER TABLE "apr_hr_details" ADD COLUMN "branch_id" uuid;--> statement-breakpoint
ALTER TABLE "apr_hr_details" ADD COLUMN "budget_category_id" uuid;--> statement-breakpoint
ALTER TABLE "apr_hr_details" ADD COLUMN "budget_allocated_paise" bigint;--> statement-breakpoint
ALTER TABLE "apr_hr_details" ADD COLUMN "budget_available_paise" bigint;--> statement-breakpoint
ALTER TABLE "apr_hr_details" ADD COLUMN "budget_remaining_paise" bigint;--> statement-breakpoint
ALTER TABLE "apr_hr_details" ADD CONSTRAINT "apr_hr_details_branch_id_apr_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."apr_branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apr_hr_details" ADD CONSTRAINT "apr_hr_details_budget_category_id_apr_categories_id_fk" FOREIGN KEY ("budget_category_id") REFERENCES "public"."apr_categories"("id") ON DELETE restrict ON UPDATE no action;