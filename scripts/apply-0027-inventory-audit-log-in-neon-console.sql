-- Applies migration 0027 (inv_audit_log: the Inventory module's own audit log) to the live database, by hand.
-- Paste the whole file into the SQL Editor of the database production uses (check DB_DRIVER in Vercel: "pg" means Supabase, otherwise
-- Neon; and use the database DATABASE_URL points to) and run it BEFORE the audit log code is deployed.
--
-- Additive only, and safe to run more than once:
--   - it only CREATES the table inv_audit_log, its foreign key to branches and three indexes. No existing table, column or row is changed.
--   - everything is in one transaction, and each part only if it is not there yet.
--   - the code running in production today never mentions inv_audit_log, so it keeps working unchanged after this runs.
--   - if the new code ever runs without this table, every Inventory action still works: only its audit entry is not saved (and the
--     server log says so).
--
-- To undo it:
--   DROP TABLE inv_audit_log;
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash = '58f7ff9ce5299c76276c4d8b869a59b7993ae5e6275b9ee46a54473009c1d0ee';

BEGIN;

CREATE TABLE IF NOT EXISTS "inv_audit_log" (
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

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inv_audit_log_branch_id_branches_id_fk') THEN
    ALTER TABLE "inv_audit_log" ADD CONSTRAINT "inv_audit_log_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "inv_audit_log_created_idx" ON "inv_audit_log" USING btree ("created_at" DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS "inv_audit_log_actor_idx" ON "inv_audit_log" USING btree ("actor_id");
CREATE INDEX IF NOT EXISTS "inv_audit_log_branch_idx" ON "inv_audit_log" USING btree ("branch_id");

-- Migration log entry (hash of drizzle/0027_inventory_audit_log.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT '58f7ff9ce5299c76276c4d8b869a59b7993ae5e6275b9ee46a54473009c1d0ee', 1793363562258
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = '58f7ff9ce5299c76276c4d8b869a59b7993ae5e6275b9ee46a54473009c1d0ee');

COMMIT;

-- Afterwards this should return one row, inv_audit_log, with 10 columns:
-- SELECT table_name, count(*) AS columns FROM information_schema.columns WHERE table_name = 'inv_audit_log' GROUP BY table_name;
