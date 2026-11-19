ALTER TYPE "public"."apr_request_type" ADD VALUE 'budget';--> statement-breakpoint
ALTER TABLE "apr_requests" ADD COLUMN "budget_details" jsonb;--> statement-breakpoint
ALTER TABLE "apr_requests" ADD COLUMN "parent_request_id" uuid;--> statement-breakpoint
ALTER TABLE "apr_requests" ADD COLUMN "revision_no" integer;--> statement-breakpoint
CREATE INDEX "apr_requests_parent_idx" ON "apr_requests" USING btree ("parent_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "apr_requests_one_open_revision_uq" ON "apr_requests" USING btree ("parent_request_id") WHERE "apr_requests"."parent_request_id" is not null and "apr_requests"."status" in ('draft', 'pending');--> statement-breakpoint
ALTER TABLE "apr_requests" ADD CONSTRAINT "apr_requests_parent_revision_uq" UNIQUE("parent_request_id","revision_no");