ALTER TABLE "design_proof_versions" ADD COLUMN "item_key" text;--> statement-breakpoint
ALTER TABLE "design_tickets" ADD COLUMN "per_item" boolean DEFAULT false NOT NULL;