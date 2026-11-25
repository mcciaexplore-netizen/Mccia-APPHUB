CREATE TYPE "public"."att_punch_place" AS ENUM('in_office', 'remote');--> statement-breakpoint
ALTER TABLE "att_attendance" ADD COLUMN "check_in_accuracy_m" double precision;--> statement-breakpoint
ALTER TABLE "att_attendance" ADD COLUMN "check_in_place" "att_punch_place";--> statement-breakpoint
ALTER TABLE "att_attendance" ADD COLUMN "check_in_distance_m" integer;--> statement-breakpoint
ALTER TABLE "att_attendance" ADD COLUMN "check_in_area" text;--> statement-breakpoint
ALTER TABLE "att_attendance" ADD COLUMN "check_out_lat" double precision;--> statement-breakpoint
ALTER TABLE "att_attendance" ADD COLUMN "check_out_lng" double precision;--> statement-breakpoint
ALTER TABLE "att_attendance" ADD COLUMN "check_out_ip" text;--> statement-breakpoint
ALTER TABLE "att_attendance" ADD COLUMN "check_out_accuracy_m" double precision;--> statement-breakpoint
ALTER TABLE "att_attendance" ADD COLUMN "check_out_place" "att_punch_place";--> statement-breakpoint
ALTER TABLE "att_attendance" ADD COLUMN "check_out_distance_m" integer;--> statement-breakpoint
ALTER TABLE "att_attendance" ADD COLUMN "check_out_area" text;