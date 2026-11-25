DROP INDEX "att_regularization_live_uq";--> statement-breakpoint
ALTER TABLE "att_regularization_requests" ADD COLUMN "is_future" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "att_regularization_requests" ADD COLUMN "planned_date" date;--> statement-breakpoint
ALTER TABLE "att_regularization_requests" ADD COLUMN "planned_checkin" time;--> statement-breakpoint
ALTER TABLE "att_regularization_requests" ADD COLUMN "planned_checkout" time;--> statement-breakpoint
CREATE UNIQUE INDEX "att_regularization_live_uq" ON "att_regularization_requests" USING btree ("user_id","date","is_future") WHERE status in ('pending', 'approved');