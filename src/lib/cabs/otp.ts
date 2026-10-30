import "server-only";
import { randomInt } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { writeCabAudit } from "./audit";
import { CabsError } from "./errors";
import type { CabUser } from "./host-adapter";
import { OTP_MAX_ATTEMPTS, mapsLink, num, otpExpiry } from "./otp-rules";

/**
 * Ride OTPs. One per ride, made when it is assigned; the rider sees it on My Rides, the driver types it in at the pickup, and that is what
 * starts the ride. Checking it is ONE statement (the production driver has no transactions): it counts the try, marks the code used only
 * when it matches, and moves the ride to in_progress only when it is this driver's assigned ride. Three wrong tries lock it until a Cabs
 * admin makes a new one.
 */

type Actor = Pick<CabUser, "id" | "name">;
const rows = <T,>(res: unknown) => (res as { rows: T[] }).rows;

/** A new 4-digit code, from a cryptographic random source. */
export const newOtp = () => String(randomInt(0, 10_000)).padStart(4, "0");

/** Makes (or replaces) the ride's OTP, with no tries used. Called when a ride is assigned, and by an admin's "New OTP". */
export async function issueOtp(rideId: string, scheduledFor: Date): Promise<void> {
  await db.execute(sql`
    insert into cab_ride_otps (ride_id, otp, expires_at) values (${rideId}, ${newOtp()}, ${otpExpiry(scheduledFor)})
    on conflict (ride_id) do update set otp = excluded.otp, attempts = 0, verified_at = null, expires_at = excluded.expires_at, created_at = now()`);
}

/** A Cabs admin's "New OTP": only for a ride still waiting for its driver to pick up (assigned). */
export async function resetOtp(rideId: string, actor: Actor): Promise<void> {
  const [ride] = rows<{ status: string; scheduled_for: string; pickup: string; dropoff: string }>(await db.execute(sql`select status, scheduled_for, pickup, dropoff from cab_rides where id = ${rideId}`));
  if (!ride) throw new CabsError("That ride no longer exists. Reload and try again.", 404);
  if (ride.status !== "assigned") throw new CabsError("Only an assigned ride, not yet picked up, gets a new OTP.", 409);
  await issueOtp(rideId, new Date(ride.scheduled_for));
  await writeCabAudit(actor, "otp_reset", { rideId, subject: `${ride.pickup} → ${ride.dropoff}` });
}

/**
 * The driver types the rider's OTP. Right: the ride is in progress and the driver gets the Google Maps link. Wrong: one try used (409
 * with how many are left); three wrong locks it. The code itself is never sent back.
 */
export async function verifyOtp(rideId: string, given: string, driver: Pick<CabUser, "id" | "name" | "driverId">): Promise<{ mapsUrl: string }> {
  if (!driver.driverId) throw new CabsError("Not allowed.", 403);
  const [row] = rows<Record<string, unknown>>(await db.execute(sql`
    with o as (
      update cab_ride_otps set attempts = attempts + case when otp = ${given} then 0 else 1 end,
        verified_at = case when otp = ${given} then now() else null end
      where ride_id = ${rideId} and verified_at is null and attempts < ${OTP_MAX_ATTEMPTS} and expires_at > now()
        and exists (select 1 from cab_rides where id = ${rideId} and status = 'assigned' and driver_id = ${driver.driverId})
      returning verified_at, attempts),
    r as (
      update cab_rides set status = 'in_progress', started_at = now(), otp_verified_at = now(), updated_at = now()
      where id = ${rideId} and status = 'assigned' and driver_id = ${driver.driverId} and exists (select 1 from o where verified_at is not null)
      returning pickup, dropoff, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, stops)
    select (select attempts from o) as attempts, (select verified_at from o) as verified_at, r.* from (select 1) one left join r on true`));
  if (row?.pickup) {
    const ride = { pickup: String(row.pickup), dropoff: String(row.dropoff) };
    await writeCabAudit(driver, "ride_started", { rideId, subject: `${ride.pickup} → ${ride.dropoff}`, details: { by: "OTP" } });
    const stops = (Array.isArray(row.stops) ? row.stops : typeof row.stops === "string" ? JSON.parse(row.stops) : []) as { text: string; lat: number | null; lng: number | null }[];
    return { mapsUrl: mapsLink({ text: ride.pickup, lat: num(row.pickup_lat), lng: num(row.pickup_lng) }, { text: ride.dropoff, lat: num(row.dropoff_lat), lng: num(row.dropoff_lng) }, stops) };
  }
  if (row?.attempts != null) {
    const left = OTP_MAX_ATTEMPTS - Number(row.attempts);
    await writeCabAudit(driver, "otp_failed", { rideId, subject: "Wrong OTP", details: { triesLeft: left } });
    throw new CabsError(left > 0 ? `Wrong OTP. ${left} ${left === 1 ? "try" : "tries"} left.` : "Wrong OTP. It is now locked: ask a Cabs admin for a new one.", 409);
  }
  // Nothing was tried: say why.
  const [state] = rows<{ status: string | null; mine: boolean; otp: boolean; attempts: number | null; verified: boolean; expired: boolean }>(await db.execute(sql`
    select r.status::text as status, r.driver_id = ${driver.driverId} as mine, o.ride_id is not null as otp, o.attempts, o.verified_at is not null as verified, o.expires_at <= now() as expired
    from (select 1) one left join cab_rides r on r.id = ${rideId} left join cab_ride_otps o on o.ride_id = ${rideId}`));
  if (!state?.status || !state.mine) throw new CabsError("That ride no longer exists. Reload and try again.", 404);
  if (state.status !== "assigned") throw new CabsError(`This ride is ${state.status.replace("_", " ")}, so it can't be started now.`, 409);
  if (!state.otp) throw new CabsError("This ride has no OTP. Use Start Ride instead.", 409);
  if (state.expired) throw new CabsError("This OTP has expired. Ask a Cabs admin for a new one.", 409);
  throw new CabsError("This OTP is locked after 3 wrong tries. Ask a Cabs admin for a new one.", 409);
}
