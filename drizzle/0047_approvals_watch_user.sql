ALTER TABLE "apr_watchers" ALTER COLUMN "form_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "apr_watchers" ADD COLUMN "watched_user_id" uuid;--> statement-breakpoint
ALTER TABLE "apr_watchers" ADD CONSTRAINT "apr_watchers_watched_user_id_users_id_fk" FOREIGN KEY ("watched_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "apr_watchers_user_rule_uq" ON "apr_watchers" USING btree ("user_id","watched_user_id") WHERE watched_user_id is not null;--> statement-breakpoint
CREATE INDEX "apr_watchers_watched_idx" ON "apr_watchers" USING btree ("watched_user_id");--> statement-breakpoint
ALTER TABLE "apr_watchers" ADD CONSTRAINT "apr_watchers_one_kind" CHECK ((form_type is not null and watched_user_id is null) or (form_type is null and watched_user_id is not null and category is null));