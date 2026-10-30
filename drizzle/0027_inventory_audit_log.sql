CREATE TABLE "inv_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_name" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid,
	"target_label" text NOT NULL,
	"details" jsonb,
	"branch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inv_audit_log" ADD CONSTRAINT "inv_audit_log_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inv_audit_log_created_idx" ON "inv_audit_log" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "inv_audit_log_actor_idx" ON "inv_audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "inv_audit_log_branch_idx" ON "inv_audit_log" USING btree ("branch_id");