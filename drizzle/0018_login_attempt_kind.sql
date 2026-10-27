ALTER TABLE "login_attempts" ADD COLUMN "kind" text DEFAULT 'login' NOT NULL;--> statement-breakpoint
ALTER TABLE "login_attempts" ADD COLUMN "blocked" boolean DEFAULT false NOT NULL;