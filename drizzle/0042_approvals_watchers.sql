CREATE TABLE "apr_watchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_type" text NOT NULL,
	"user_id" uuid NOT NULL,
	"added_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "apr_watchers_form_user_uq" ON "apr_watchers" USING btree ("form_type","user_id");--> statement-breakpoint
CREATE INDEX "apr_watchers_user_idx" ON "apr_watchers" USING btree ("user_id");