ALTER TYPE "public"."apr_event_action" ADD VALUE 'viewed';--> statement-breakpoint
CREATE TABLE "apr_file_chunks" (
	"file_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"data" "bytea" NOT NULL,
	CONSTRAINT "apr_file_chunks_file_id_idx_pk" PRIMARY KEY("file_id","idx")
);
--> statement-breakpoint
CREATE TABLE "apr_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"file_name" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"chunk_count" integer NOT NULL,
	"attached" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apr_requests" ADD COLUMN "over_budget" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "apr_file_chunks" ADD CONSTRAINT "apr_file_chunks_file_id_apr_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."apr_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apr_files_uploader_idx" ON "apr_files" USING btree ("uploaded_by","created_at");