ALTER TABLE "cab_drivers" DROP CONSTRAINT "cab_drivers_vehicle_id_cab_vehicles_id_fk";
--> statement-breakpoint
ALTER TABLE "cab_drivers" DROP COLUMN "vehicle_id";