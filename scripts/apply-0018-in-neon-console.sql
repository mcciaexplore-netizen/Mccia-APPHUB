-- Applies migration 0018 (sign-in attempts: which form they came from, and whether they were refused by the limits) to the live database,
-- by hand. Paste the whole file into the Neon SQL Editor (project APPHUB) and run it once, BEFORE the new code is deployed: the new code
-- writes these columns on every sign-in, and sign-in fails until they exist. Do NOT run it twice (the second run stops at "already exists").

BEGIN;

ALTER TABLE "login_attempts" ADD COLUMN "kind" text DEFAULT 'login' NOT NULL;
ALTER TABLE "login_attempts" ADD COLUMN "blocked" boolean DEFAULT false NOT NULL;

-- Migration log entry (hash of drizzle/0018_login_attempt_kind.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('1acd60cb7878b43707834e451a799987d7cdc6e36ac7076467584ac2011bb006', 1792171331153);

COMMIT;

-- Afterwards this should show the two new columns:
-- SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'login_attempts' ORDER BY ordinal_position;
