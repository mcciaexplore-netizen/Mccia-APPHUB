-- Applies migration 0036 (IVR-CRM: the Membership team's calling CRM, connected to Tata Smartflo and Zoho Mail) to the live database, by
-- hand. Paste the whole file into the SQL Editor of the database production uses (check DB_DRIVER in Vercel: "pg" means Supabase, otherwise
-- Neon; and use the database DATABASE_URL points to) and run it BEFORE this code is deployed. It does not depend on any earlier script
-- beyond the hub's own tables.
--
-- Safe to run more than once, and it changes no existing row:
--   - only NEW tables and types, every one prefixed ivr_ (16 tables, 5 types). No hub table is touched.
--   - the nine default call categories (Membership, Proforma invoice, Hall booking ...); an existing category is left as it is.
--   - everything is in one transaction.
--   - the code running in production today never reads these tables, so it keeps working, and so does Instant Rollback.
--   - IVR-CRM stays switched off until IVR_ENABLED=true is set in Vercel, so the tables can exist before anyone uses them.
--
-- To undo it (throws away every IVR-CRM member, call, note and setting):
--   DROP TABLE IF EXISTS ivr_agent_profiles, ivr_allocation_rules, ivr_settings, ivr_audit, ivr_call_categories, ivr_call_events, ivr_calls, ivr_dial_requests, ivr_emails, ivr_import_batches, ivr_integrations, ivr_lead_assignments, ivr_lead_stage_events, ivr_leads, ivr_notes, ivr_smartflo_agents CASCADE;
--   DROP TYPE IF EXISTS ivr_category_applies_to, ivr_call_status, ivr_call_outcome, ivr_provider, ivr_stage;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = 'e3e0d2c115add503ba785cc07b16b9ac2feb102e08e6dae74be22962d6da9bd2';

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ivr_category_applies_to') THEN
    CREATE TYPE "public"."ivr_category_applies_to" AS ENUM('inbound', 'outbound', 'both');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ivr_call_status') THEN
    CREATE TYPE "public"."ivr_call_status" AS ENUM('answered', 'missed', 'ongoing', 'unknown');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ivr_call_outcome') THEN
    CREATE TYPE "public"."ivr_call_outcome" AS ENUM('answered', 'not_answered', 'busy', 'switched_off', 'invalid', 'failed');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ivr_provider') THEN
    CREATE TYPE "public"."ivr_provider" AS ENUM('smartflo_org', 'smartflo_c2c', 'zoho');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ivr_stage') THEN
    CREATE TYPE "public"."ivr_stage" AS ENUM('new', 'attempted', 'connected', 'closed');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "ivr_agent_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"phone" text,
	"softphone_extension" text,
	"smartflo_agent_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "ivr_allocation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL
);

CREATE TABLE IF NOT EXISTS "ivr_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "ivr_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"target" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "ivr_call_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"applies_to" "ivr_category_applies_to" DEFAULT 'both' NOT NULL,
	"ivr_key" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "ivr_call_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger" text,
	"call_id" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);

CREATE TABLE IF NOT EXISTS "ivr_calls" (
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

CREATE TABLE IF NOT EXISTS "ivr_dial_requests" (
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

CREATE TABLE IF NOT EXISTS "ivr_emails" (
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

CREATE TABLE IF NOT EXISTS "ivr_import_batches" (
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

CREATE TABLE IF NOT EXISTS "ivr_integrations" (
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

CREATE TABLE IF NOT EXISTS "ivr_lead_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"from_user_id" uuid,
	"to_user_id" uuid,
	"by_user_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "ivr_lead_stage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"from_stage" "ivr_stage",
	"to_stage" "ivr_stage" NOT NULL,
	"by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "ivr_leads" (
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

CREATE TABLE IF NOT EXISTS "ivr_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "ivr_smartflo_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"number" text,
	"extension" text,
	"email" text,
	"mapped_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ivr_allocation_rules_category_id_ivr_call_categories_id_fk') THEN
    ALTER TABLE "ivr_allocation_rules" ADD CONSTRAINT "ivr_allocation_rules_category_id_ivr_call_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."ivr_call_categories"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ivr_calls_lead_id_ivr_leads_id_fk') THEN
    ALTER TABLE "ivr_calls" ADD CONSTRAINT "ivr_calls_lead_id_ivr_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."ivr_leads"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ivr_calls_category_id_ivr_call_categories_id_fk') THEN
    ALTER TABLE "ivr_calls" ADD CONSTRAINT "ivr_calls_category_id_ivr_call_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."ivr_call_categories"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ivr_dial_requests_lead_id_ivr_leads_id_fk') THEN
    ALTER TABLE "ivr_dial_requests" ADD CONSTRAINT "ivr_dial_requests_lead_id_ivr_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."ivr_leads"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ivr_dial_requests_category_id_ivr_call_categories_id_fk') THEN
    ALTER TABLE "ivr_dial_requests" ADD CONSTRAINT "ivr_dial_requests_category_id_ivr_call_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."ivr_call_categories"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ivr_dial_requests_resolved_call_id_ivr_calls_id_fk') THEN
    ALTER TABLE "ivr_dial_requests" ADD CONSTRAINT "ivr_dial_requests_resolved_call_id_ivr_calls_id_fk" FOREIGN KEY ("resolved_call_id") REFERENCES "public"."ivr_calls"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ivr_emails_lead_id_ivr_leads_id_fk') THEN
    ALTER TABLE "ivr_emails" ADD CONSTRAINT "ivr_emails_lead_id_ivr_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."ivr_leads"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ivr_lead_assignments_lead_id_ivr_leads_id_fk') THEN
    ALTER TABLE "ivr_lead_assignments" ADD CONSTRAINT "ivr_lead_assignments_lead_id_ivr_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."ivr_leads"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ivr_lead_stage_events_lead_id_ivr_leads_id_fk') THEN
    ALTER TABLE "ivr_lead_stage_events" ADD CONSTRAINT "ivr_lead_stage_events_lead_id_ivr_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."ivr_leads"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ivr_leads_category_id_ivr_call_categories_id_fk') THEN
    ALTER TABLE "ivr_leads" ADD CONSTRAINT "ivr_leads_category_id_ivr_call_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."ivr_call_categories"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ivr_leads_import_batch_id_ivr_import_batches_id_fk') THEN
    ALTER TABLE "ivr_leads" ADD CONSTRAINT "ivr_leads_import_batch_id_ivr_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."ivr_import_batches"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ivr_notes_lead_id_ivr_leads_id_fk') THEN
    ALTER TABLE "ivr_notes" ADD CONSTRAINT "ivr_notes_lead_id_ivr_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."ivr_leads"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "ivr_allocation_rules_uq" ON "ivr_allocation_rules" USING btree ("category_id","user_id");

CREATE INDEX IF NOT EXISTS "ivr_audit_created_idx" ON "ivr_audit" USING btree ("created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "ivr_call_categories_key_uq" ON "ivr_call_categories" USING btree ("key");

CREATE INDEX IF NOT EXISTS "ivr_call_events_call_idx" ON "ivr_call_events" USING btree ("call_id");

CREATE UNIQUE INDEX IF NOT EXISTS "ivr_calls_smartflo_call_id_uq" ON "ivr_calls" USING btree ("smartflo_call_id");

CREATE INDEX IF NOT EXISTS "ivr_calls_agent_started_idx" ON "ivr_calls" USING btree ("agent_user_id","started_at");

CREATE INDEX IF NOT EXISTS "ivr_calls_lead_idx" ON "ivr_calls" USING btree ("lead_id");

CREATE INDEX IF NOT EXISTS "ivr_calls_customer_idx" ON "ivr_calls" USING btree ("customer_number");

CREATE INDEX IF NOT EXISTS "ivr_calls_ref_idx" ON "ivr_calls" USING btree ("ref_id");

CREATE INDEX IF NOT EXISTS "ivr_calls_started_idx" ON "ivr_calls" USING btree ("started_at");

CREATE INDEX IF NOT EXISTS "ivr_calls_category_idx" ON "ivr_calls" USING btree ("category_id");

CREATE INDEX IF NOT EXISTS "ivr_dial_requests_ref_idx" ON "ivr_dial_requests" USING btree ("ref_id");

CREATE INDEX IF NOT EXISTS "ivr_dial_requests_lead_idx" ON "ivr_dial_requests" USING btree ("lead_id","requested_at");

CREATE INDEX IF NOT EXISTS "ivr_emails_lead_idx" ON "ivr_emails" USING btree ("lead_id");

CREATE INDEX IF NOT EXISTS "ivr_integrations_user_idx" ON "ivr_integrations" USING btree ("user_id","provider");

CREATE INDEX IF NOT EXISTS "ivr_lead_assignments_lead_idx" ON "ivr_lead_assignments" USING btree ("lead_id");

CREATE INDEX IF NOT EXISTS "ivr_lead_stage_events_lead_idx" ON "ivr_lead_stage_events" USING btree ("lead_id");

CREATE UNIQUE INDEX IF NOT EXISTS "ivr_leads_phone_uq" ON "ivr_leads" USING btree ("phone");

CREATE INDEX IF NOT EXISTS "ivr_leads_owner_stage_idx" ON "ivr_leads" USING btree ("owner_id","stage");

CREATE INDEX IF NOT EXISTS "ivr_leads_queue_idx" ON "ivr_leads" USING btree ("owner_id","stage","last_call_at");

CREATE INDEX IF NOT EXISTS "ivr_notes_lead_idx" ON "ivr_notes" USING btree ("lead_id");

-- The default call categories (src/lib/ivr/categories.ts). The IVR menu keys 1 to 5 are placeholders: set the real ones under IVR-CRM
-- Admin → Categories.
INSERT INTO "ivr_call_categories" ("key", "label", "applies_to", "ivr_key", "sort") VALUES
  ('membership', 'Membership', 'both', '1', 0),
  ('membership_enquiry', 'Membership enquiry', 'both', '2', 1),
  ('proforma', 'Proforma invoice', 'both', '3', 2),
  ('event_paid_info', 'Event (paid info)', 'both', '4', 3),
  ('hall_booking', 'Hall booking', 'both', '5', 4),
  ('booking_confirmation', 'Booking confirmation', 'both', NULL, 5),
  ('confirmation_call', 'Confirmation call', 'outbound', NULL, 6),
  ('poc_change', 'POC change', 'both', NULL, 7),
  ('other', 'Other', 'both', NULL, 8)
ON CONFLICT ("key") DO NOTHING;

-- Migration log entry (hash of drizzle/0036_ivr.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT 'e3e0d2c115add503ba785cc07b16b9ac2feb102e08e6dae74be22962d6da9bd2', 1793446916742
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = 'e3e0d2c115add503ba785cc07b16b9ac2feb102e08e6dae74be22962d6da9bd2');

COMMIT;

-- Afterwards this should return 16 and 9:
-- SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'ivr\_%') AS ivr_tables,
--        (SELECT count(*) FROM ivr_call_categories) AS categories;
