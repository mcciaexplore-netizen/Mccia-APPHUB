import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { CabsError } from "./errors";
import type { CabUser } from "./host-adapter";
import { num } from "./otp-rules";

/**
 * Drivers' live positions. A driver's phone sends one every 10 seconds while a ride is under way; admins see each driver's latest on the
 * fleet map. Positions are kept 24 hours (the daily cron deletes older ones).
 */

const rows = <T,>(res: unknown) => (res as { rows: T[] }).rows;
/** A post sooner than this after the driver's last saved position is dropped, so a busy page cannot flood the table. */
export const MIN_GAP_SECONDS = 5;
export const KEEP_HOURS = 24;

export type LocationInput = { latitude: number; longitude: number; accuracy: number | null; heading: number | null; speed: number | null; rideId: string | null };

/**
 * Saves a position for the signed-in driver (never one named in the request). A ride id is kept only when it is this driver's ride in
 * progress. One statement: dropped when the last position is under MIN_GAP_SECONDS old. Returns whether it was saved.
 */
export async function recordLocation(driver: Pick<CabUser, "driverId">, p: LocationInput): Promise<boolean> {
  if (!driver.driverId) throw new CabsError("Only drivers share their location.", 403);
  const res = rows<{ id: string }>(await db.execute(sql`
    insert into cab_driver_locations (driver_id, latitude, longitude, accuracy, heading, speed, ride_id)
    select ${driver.driverId}, ${p.latitude}, ${p.longitude}, ${p.accuracy}, ${p.heading}, ${p.speed},
      (select id from cab_rides where id = ${p.rideId}::uuid and driver_id = ${driver.driverId} and status = 'in_progress')
    where not exists (select 1 from cab_driver_locations where driver_id = ${driver.driverId} and recorded_at > now() - make_interval(secs => ${MIN_GAP_SECONDS}))
    returning id`));
  return res.length > 0;
}

export type FleetEntry = {
  driver_id: string; driver_name: string; is_available: boolean; latitude: number; longitude: number; heading: number | null; speed: number | null; recorded_at: string;
  current_ride_id: string | null; current_ride_status: string | null; current_ride: string | null; vehicle_plate: string | null;
};

/**
 * Each driver's latest position from the last 24 hours, with the ride they are on now (in progress first, else their next assigned one)
 * and its vehicle (else their usual one). Drivers who have sent nothing in that time are not on the map.
 */
export async function fleet(): Promise<FleetEntry[]> {
  const r = rows<Record<string, unknown>>(await db.execute(sql`
    select d.id as driver_id, d.name as driver_name, d.is_available, l.latitude, l.longitude, l.heading, l.speed, l.recorded_at,
      cr.id as current_ride_id, cr.status::text as current_ride_status, cr.pickup || ' → ' || cr.dropoff as current_ride,
      coalesce(cr.vehicle_plate, v.number_plate) as vehicle_plate
    from cab_drivers d
    join lateral (select latitude, longitude, heading, speed, recorded_at from cab_driver_locations
      where driver_id = d.id and recorded_at > now() - make_interval(hours => ${KEEP_HOURS}) order by recorded_at desc limit 1) l on true
    left join lateral (select id, status, pickup, dropoff, vehicle_plate from cab_rides
      where driver_id = d.id and status in ('in_progress', 'assigned') order by (status = 'in_progress') desc, scheduled_for limit 1) cr on true
    left join cab_vehicles v on v.id = d.vehicle_id
    order by d.name`));
  return r.map((x) => ({
    driver_id: String(x.driver_id), driver_name: String(x.driver_name), is_available: !!x.is_available, latitude: Number(x.latitude), longitude: Number(x.longitude),
    heading: num(x.heading), speed: num(x.speed), recorded_at: new Date(x.recorded_at as string).toISOString(),
    current_ride_id: (x.current_ride_id as string) ?? null, current_ride_status: (x.current_ride_status as string) ?? null, current_ride: (x.current_ride as string) ?? null,
    vehicle_plate: (x.vehicle_plate as string) ?? null,
  }));
}

/** For the daily cron: positions older than 24 hours. Returns how many were deleted. */
export async function deleteOldLocations(): Promise<number> {
  return rows<{ n: number }>(await db.execute(sql`with d as (delete from cab_driver_locations where recorded_at < now() - make_interval(hours => ${KEEP_HOURS}) returning 1) select count(*)::int as n from d`))[0].n;
}
