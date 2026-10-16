CREATE TYPE "public"."department_kind" AS ENUM('organisation', 'application');--> statement-breakpoint
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
--> statement-breakpoint
ALTER TABLE "departments" DROP CONSTRAINT "departments_name_unique";--> statement-breakpoint
ALTER TABLE "departments" DROP CONSTRAINT "departments_slug_unique";--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "kind" "department_kind" DEFAULT 'application' NOT NULL;--> statement-breakpoint
ALTER TABLE "hub_notifications" ADD CONSTRAINT "hub_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hub_notifications_user_idx" ON "hub_notifications" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_kind_name_uq" UNIQUE("kind","name");--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_kind_slug_uq" UNIQUE("kind","slug");--> statement-breakpoint
INSERT INTO "departments" ("kind", "name", "slug", "icon", "sort_order") VALUES
	('organisation', 'Finance', 'finance', 'Building2', 10),
	('organisation', 'IT', 'it', 'Building2', 20),
	('organisation', 'AI', 'ai', 'Building2', 30),
	('organisation', 'ERU', 'eru', 'Building2', 40),
	('organisation', 'Defense', 'defense', 'Building2', 50),
	('organisation', 'CBP', 'cbp', 'Building2', 60),
	('organisation', 'Graphics', 'graphics', 'Building2', 70)
ON CONFLICT ("kind", "name") DO NOTHING;
