CREATE TYPE "public"."ivr_category_applies_to" AS ENUM('inbound', 'outbound', 'both');--> statement-breakpoint
CREATE TYPE "public"."ivr_call_status" AS ENUM('answered', 'missed', 'ongoing', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."ivr_call_outcome" AS ENUM('answered', 'not_answered', 'busy', 'switched_off', 'invalid', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ivr_provider" AS ENUM('smartflo_org', 'smartflo_c2c', 'zoho');--> statement-breakpoint
CREATE TYPE "public"."ivr_stage" AS ENUM('new', 'attempted', 'connected', 'closed');--> statement-breakpoint
CREATE TABLE "ivr_agent_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"phone" text,
	"softphone_extension" text,
	"smartflo_agent_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ivr_allocation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ivr_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ivr_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"target" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ivr_call_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"applies_to" "ivr_category_applies_to" DEFAULT 'both' NOT NULL,
	"ivr_key" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ivr_call_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" text,
	"call_id" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "ivr_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"smartflo_call_id" text NOT NULL,
	"lead_id" uuid,
	"agent_user_id" uuid,
	"smartflo_agent_id" text,
	"agent_name" text,
	"agent_number" text,
	"direction" text DEFAULT 'inbound' NOT NULL,
	"status" "ivr_call_status" DEFAULT 'unknown' NOT NULL,
	"outcome" "ivr_call_outcome",
	"category_id" uuid,
	"category_source" text,
	"remark" text,
	"customer_number" text NOT NULL,
	"did_number" text,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_sec" integer DEFAULT 0 NOT NULL,
	"answered_sec" integer DEFAULT 0 NOT NULL,
	"recording_url" text,
	"dtmf" text,
	"disposition" text,
	"hangup_cause" text,
	"ref_id" text,
	"call_flow" jsonb,
	"raw" jsonb,
	"source" text DEFAULT 'sync' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ivr_dial_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"user_id" uuid,
	"category_id" uuid,
	"ref_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"resolved_call_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ivr_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"user_id" uuid,
	"to_address" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"zoho_message_id" text,
	"status" text DEFAULT 'sent' NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ivr_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" text NOT NULL,
	"uploaded_by" uuid,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"matched" integer DEFAULT 0 NOT NULL,
	"ambiguous" integer DEFAULT 0 NOT NULL,
	"unmatched" integer DEFAULT 0 NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'saved' NOT NULL,
	"column_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ivr_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"provider" "ivr_provider" NOT NULL,
	"encrypted_secret" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ivr_lead_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"from_user_id" uuid,
	"to_user_id" uuid,
	"by_user_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ivr_lead_stage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"from_stage" "ivr_stage",
	"to_stage" "ivr_stage" NOT NULL,
	"by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ivr_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"company" text,
	"query" text,
	"source" text,
	"stage" "ivr_stage" DEFAULT 'new' NOT NULL,
	"owner_id" uuid,
	"member_code" text,
	"category_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_outcome" "ivr_call_outcome",
	"last_call_at" timestamp with time zone,
	"import_batch_id" uuid,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ivr_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ivr_smartflo_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"number" text,
	"extension" text,
	"email" text,
	"mapped_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ivr_allocation_rules" ADD CONSTRAINT "ivr_allocation_rules_category_id_ivr_call_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."ivr_call_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ivr_calls" ADD CONSTRAINT "ivr_calls_lead_id_ivr_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."ivr_leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ivr_calls" ADD CONSTRAINT "ivr_calls_category_id_ivr_call_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."ivr_call_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ivr_dial_requests" ADD CONSTRAINT "ivr_dial_requests_lead_id_ivr_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."ivr_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ivr_dial_requests" ADD CONSTRAINT "ivr_dial_requests_category_id_ivr_call_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."ivr_call_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ivr_dial_requests" ADD CONSTRAINT "ivr_dial_requests_resolved_call_id_ivr_calls_id_fk" FOREIGN KEY ("resolved_call_id") REFERENCES "public"."ivr_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ivr_emails" ADD CONSTRAINT "ivr_emails_lead_id_ivr_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."ivr_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ivr_lead_assignments" ADD CONSTRAINT "ivr_lead_assignments_lead_id_ivr_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."ivr_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ivr_lead_stage_events" ADD CONSTRAINT "ivr_lead_stage_events_lead_id_ivr_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."ivr_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ivr_leads" ADD CONSTRAINT "ivr_leads_category_id_ivr_call_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."ivr_call_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ivr_leads" ADD CONSTRAINT "ivr_leads_import_batch_id_ivr_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."ivr_import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ivr_notes" ADD CONSTRAINT "ivr_notes_lead_id_ivr_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."ivr_leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ivr_allocation_rules_uq" ON "ivr_allocation_rules" USING btree ("category_id","user_id");--> statement-breakpoint
CREATE INDEX "ivr_audit_created_idx" ON "ivr_audit" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ivr_call_categories_key_uq" ON "ivr_call_categories" USING btree ("key");--> statement-breakpoint
CREATE INDEX "ivr_call_events_call_idx" ON "ivr_call_events" USING btree ("call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ivr_calls_smartflo_call_id_uq" ON "ivr_calls" USING btree ("smartflo_call_id");--> statement-breakpoint
CREATE INDEX "ivr_calls_agent_started_idx" ON "ivr_calls" USING btree ("agent_user_id","started_at");--> statement-breakpoint
CREATE INDEX "ivr_calls_lead_idx" ON "ivr_calls" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "ivr_calls_customer_idx" ON "ivr_calls" USING btree ("customer_number");--> statement-breakpoint
CREATE INDEX "ivr_calls_ref_idx" ON "ivr_calls" USING btree ("ref_id");--> statement-breakpoint
CREATE INDEX "ivr_calls_started_idx" ON "ivr_calls" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "ivr_calls_category_idx" ON "ivr_calls" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "ivr_dial_requests_ref_idx" ON "ivr_dial_requests" USING btree ("ref_id");--> statement-breakpoint
CREATE INDEX "ivr_dial_requests_lead_idx" ON "ivr_dial_requests" USING btree ("lead_id","requested_at");--> statement-breakpoint
CREATE INDEX "ivr_emails_lead_idx" ON "ivr_emails" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "ivr_integrations_user_idx" ON "ivr_integrations" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "ivr_lead_assignments_lead_idx" ON "ivr_lead_assignments" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "ivr_lead_stage_events_lead_idx" ON "ivr_lead_stage_events" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ivr_leads_phone_uq" ON "ivr_leads" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "ivr_leads_owner_stage_idx" ON "ivr_leads" USING btree ("owner_id","stage");--> statement-breakpoint
CREATE INDEX "ivr_leads_queue_idx" ON "ivr_leads" USING btree ("owner_id","stage","last_call_at");--> statement-breakpoint
CREATE INDEX "ivr_notes_lead_idx" ON "ivr_notes" USING btree ("lead_id");