DROP INDEX "apr_watchers_form_user_uq";--> statement-breakpoint
ALTER TABLE "apr_watchers" ADD COLUMN "category" text;--> statement-breakpoint
CREATE UNIQUE INDEX "apr_watchers_rule_uq" ON "apr_watchers" USING btree ("form_type","user_id",coalesce("category", ''));