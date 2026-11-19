CREATE TABLE "apr_departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "apr_departments_name_uq" ON "apr_departments" USING btree (lower("name"));--> statement-breakpoint
INSERT INTO "apr_departments" ("name", "sort") VALUES ('Finance', 10), ('HR', 20), ('Operations', 30), ('Marketing', 40), ('IT / AI Studio', 50), ('Administration', 60), ('Membership', 70), ('Events', 80), ('Research (ERU)', 90), ('Design Team', 100) ON CONFLICT DO NOTHING;
