CREATE TABLE "app_admins" (
	"app_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"added_by_id" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_admins_app_id_user_id_pk" PRIMARY KEY("app_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "app_admins" ADD CONSTRAINT "app_admins_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_admins" ADD CONSTRAINT "app_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_admins" ADD CONSTRAINT "app_admins_added_by_id_users_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_admins_user_idx" ON "app_admins" USING btree ("user_id");