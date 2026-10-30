ALTER TABLE "cab_drivers" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cab_drivers" ADD CONSTRAINT "cab_drivers_phone_unique" UNIQUE("phone");