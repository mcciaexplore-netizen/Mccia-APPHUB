-- Applies migration 0011 (departments split into organisation departments and application groups, and hub notifications) to the live database, by hand.
-- Paste the whole file into the Neon SQL Editor (project APPHUB) and run it once, BEFORE the new code is deployed.
--
-- It only ADDS: a "kind" on every department (every department that exists today becomes an "application" group, so nothing moves),
-- a new table for notifications, and seven organisation departments (Finance, IT, AI, ERU, Defense, CBP, Graphics). The two "must be unique"
-- rules on departments become "unique within its kind", so an organisation Finance can sit beside an application group called Finance.
-- No existing row is changed or removed. It is one transaction: if any statement fails, nothing is applied. The last statement records
-- the migration in Drizzle's log (the same hash and timestamp `npm run db:migrate` would write).
-- Do NOT run it twice: the second run stops at the first statement ("already exists"), which is harmless.

BEGIN;

CREATE TYPE "public"."department_kind" AS ENUM('organisation', 'application');

CREATE TABLE "hub_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hub_notifications_user_dedupe_uq" UNIQUE("user_id","dedupe_key")
);

ALTER TABLE "departments" DROP CONSTRAINT "departments_name_unique";

ALTER TABLE "departments" DROP CONSTRAINT "departments_slug_unique";

ALTER TABLE "departments" ADD COLUMN "kind" "department_kind" DEFAULT 'application' NOT NULL;

ALTER TABLE "hub_notifications" ADD CONSTRAINT "hub_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX "hub_notifications_user_idx" ON "hub_notifications" USING btree ("user_id","created_at");

ALTER TABLE "departments" ADD CONSTRAINT "departments_kind_name_uq" UNIQUE("kind","name");

ALTER TABLE "departments" ADD CONSTRAINT "departments_kind_slug_uq" UNIQUE("kind","slug");

INSERT INTO "departments" ("kind", "name", "slug", "icon", "sort_order") VALUES
	('organisation', 'Finance', 'finance', 'Building2', 10),
	('organisation', 'IT', 'it', 'Building2', 20),
	('organisation', 'AI', 'ai', 'Building2', 30),
	('organisation', 'ERU', 'eru', 'Building2', 40),
	('organisation', 'Defense', 'defense', 'Building2', 50),
	('organisation', 'CBP', 'cbp', 'Building2', 60),
	('organisation', 'Graphics', 'graphics', 'Building2', 70)
ON CONFLICT ("kind", "name") DO NOTHING;

-- Migration log entry (hash of drizzle/0011_departments_kind_hub_notifications.sql, and its journal timestamp).
INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('74f77e6b63e9d69bdf4ed3a4b2f0c8d14f27b88740a2261d16bbec2e2101fa89', 1792145969974);

COMMIT;

-- Afterwards this should show the 7 organisation departments, and the same number of application groups as before:
-- SELECT kind, count(*) FROM departments GROUP BY kind ORDER BY kind;
