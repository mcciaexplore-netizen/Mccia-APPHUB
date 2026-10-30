import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { writeCabAudit } from "./audit";
import type { RideStatus } from "./cabs.manifest";
import { CabsError } from "./errors";
import type { CabUser } from "./host-adapter";
import { driverPerson, rideAssigned, rideCancelledByAdmin, rideCompleted, rideReceived } from "./notify";
import type { RideInput } from "./validation";

/**
 * Rides. Every change of status is ONE conditional statement (the production driver has no transactions), so two people acting at once
 * cannot both succeed: assign only from pending, start only from assigned, complete only from in_progress, cancel only from pending
 * (the person who booked it) or pending/assigned (an admin). When nothing changed, a second read says why.
 */

type Actor = Pick<CabUser, "id" | "name">;
const rows = <T,>(res: unknown) => (res as { rows: T[] }).rows;

export type RideRow = {
  id: string; requestedById: string; requestedByName: string; requestedByEmail: string; requestedByBranch: string | null;
  driverId: string | null; driverName: string | null; vehicleId: string | null; vehiclePlate: string | null; vehicleModel: string | null;
  pickup: string; dropoff: string; scheduledFor: Date; status: RideStatus; notes: string | null;
  assignedAt: Date | null; startedAt: Date | null; completedAt: Date | null; cancelledAt: Date | null; cancelledByName: string | null; cancelReason: string | null; createdAt: Date;
};

const date = (v: unknown) => (v == null ? null : new Date(v as string));
const toRide = (x: Record<string, unknown>): RideRow => ({
  id: String(x.id), requestedById: String(x.requested_by_id), requestedByName: String(x.requested_by_name), requestedByEmail: String(x.requested_by_email),
  requestedByBranch: (x.requested_by_branch as string) ?? null, driverId: (x.driver_id as string) ?? null, driverName: (x.driver_name as string) ?? null,
  vehicleId: (x.vehicle_id as string) ?? null, vehiclePlate: (x.vehicle_plate as string) ?? null, vehicleModel: (x.vehicle_model as string) ?? null,
  pickup: String(x.pickup), dropoff: String(x.dropoff), scheduledFor: new Date(x.scheduled_for as string), status: x.status as RideStatus, notes: (x.notes as string) ?? null,
  assignedAt: date(x.assigned_at), startedAt: date(x.started_at), completedAt: date(x.completed_at), cancelledAt: date(x.cancelled_at),
  cancelledByName: (x.cancelled_by_name as string) ?? null, cancelReason: (x.cancel_reason as string) ?? null, createdAt: new Date(x.created_at as string),
});

const SELECT = sql`select r.*, v.model as vehicle_model from cab_rides r left join cab_vehicles v on v.id = r.vehicle_id`;
/** Rides still to happen: not finished or cancelled. */
const OPEN = sql`r.status in ('pending', 'assigned', 'in_progress')`;

export type RideFilter = {
  requestedById?: string; driverId?: string; status?: RideStatus; branch?: string;
  /** "open": still to happen, soonest first. "past": completed or cancelled, latest first. Otherwise everything, latest first. */
  scope?: "open" | "past";
  /** Whole days in India time ("YYYY-MM-DD"), both included, on the scheduled time. */
  from?: string; to?: string;
};
const isDay = (d: string | undefined): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00+05:30`));

export async function listRides(f: RideFilter = {}, limit = 200): Promise<RideRow[]> {
  const c: SQL[] = [sql`true`];
  if (f.requestedById) c.push(sql`r.requested_by_id = ${f.requestedById}`);
  if (f.driverId) c.push(sql`r.driver_id = ${f.driverId}`);
  if (f.status) c.push(sql`r.status = ${f.status}`);
  if (f.branch) c.push(sql`r.requested_by_branch = ${f.branch}`);
  if (f.scope === "open") c.push(OPEN);
  if (f.scope === "past") c.push(sql`r.status in ('completed', 'cancelled')`);
  if (isDay(f.from)) c.push(sql`r.scheduled_for >= ${new Date(`${f.from}T00:00:00+05:30`)}`);
  if (isDay(f.to)) c.push(sql`r.scheduled_for < ${new Date(new Date(`${f.to}T00:00:00+05:30`).getTime() + 86_400_000)}`);
  const order = f.scope === "open" ? sql`r.scheduled_for asc` : sql`r.scheduled_for desc`;
  return rows<Record<string, unknown>>(await db.execute(sql`${SELECT} where ${sql.join(c, sql` and `)} order by ${order}, r.created_at desc limit ${limit}`)).map(toRide);
}

export async function getRide(id: string): Promise<RideRow | null> {
  const [x] = rows<Record<string, unknown>>(await db.execute(sql`${SELECT} where r.id = ${id}`));
  return x ? toRide(x) : null;
}

const subject = (r: { pickup: string; dropoff: string }) => `${r.pickup} → ${r.dropoff}`;

export async function createRide(input: RideInput, user: Pick<CabUser, "id" | "name" | "email" | "branchName">): Promise<{ id: string }> {
  const [row] = rows<{ id: string }>(await db.execute(sql`
    insert into cab_rides (requested_by_id, requested_by_name, requested_by_email, requested_by_branch, pickup, dropoff, scheduled_for, notes)
    values (${user.id}, ${user.name}, ${user.email}, ${user.branchName}, ${input.pickup}, ${input.dropoff}, ${input.scheduledFor}, ${input.notes})
    returning id`));
  await writeCabAudit(user, "ride_created", { rideId: row.id, subject: subject(input), details: { scheduledFor: input.scheduledFor.toISOString() } });
  await rideReceived({ id: row.id, ...input }, { userId: user.id, email: user.email });
  return row;
}

/** Why a ride did not change: gone (404), or not in the state the change needs (409, naming the state it is in). */
async function whyNot(id: string, wanted: string, mine?: { driverId: string | null }): Promise<never> {
  const ride = await getRide(id);
  if (!ride || (mine && ride.driverId !== mine.driverId)) throw new CabsError("That ride no longer exists. Reload and try again.", 404);
  if (wanted === "assign" && ride.status !== "pending") throw new CabsError(ride.status === "cancelled" ? "This ride was cancelled." : "Ride already assigned", 409);
  throw new CabsError(`This ride is ${ride.status.replace("_", " ")}, so it can't be ${wanted === "start" ? "started" : wanted === "complete" ? "completed" : "cancelled"} now.`, 409);
}

/**
 * Gives a pending ride a driver and a vehicle, in ONE statement that also requires the driver to be available and the vehicle active at
 * that moment. Two admins assigning the same ride at once: one succeeds, the other is told it was already assigned.
 */
export async function assignRide(id: string, input: { driverId: string; vehicleId: string }, actor: Actor): Promise<void> {
  const [row] = rows<Record<string, unknown>>(await db.execute(sql`
    with d as (select id, name, email from cab_drivers where id = ${input.driverId} and is_available),
    v as (select id, number_plate, model from cab_vehicles where id = ${input.vehicleId} and is_active),
    r as (
      update cab_rides set status = 'assigned', driver_id = (select id from d), vehicle_id = (select id from v),
        driver_name = (select name from d), vehicle_plate = (select number_plate from v), assigned_at = now(), updated_at = now()
      where id = ${id} and status = 'pending' and exists (select 1 from d) and exists (select 1 from v)
      returning id, requested_by_id, requested_by_email, pickup, dropoff, scheduled_for)
    select r.*, d.name as driver_name, d.email as driver_email, v.number_plate, v.model from r, d, v`));
  if (!row) {
    const [state] = rows<{ status: string | null; driver: boolean | null; available: boolean | null; vehicle: boolean | null; active: boolean | null }>(await db.execute(sql`
      select (select status::text from cab_rides where id = ${id}) as status,
        exists (select 1 from cab_drivers where id = ${input.driverId}) as driver, (select is_available from cab_drivers where id = ${input.driverId}) as available,
        exists (select 1 from cab_vehicles where id = ${input.vehicleId}) as vehicle, (select is_active from cab_vehicles where id = ${input.vehicleId}) as active`));
    if (!state.status) throw new CabsError("That ride no longer exists. Reload and try again.", 404);
    if (state.status !== "pending") return whyNot(id, "assign");
    if (!state.driver) throw new CabsError("That driver no longer exists. Reload and try again.", 404);
    if (!state.available) throw new CabsError("Driver not available. Choose another driver.", 409);
    if (!state.vehicle) throw new CabsError("That vehicle no longer exists. Reload and try again.", 404);
    throw new CabsError("Vehicle inactive. Choose an active vehicle.", 409);
  }
  const ride = { id, pickup: String(row.pickup), dropoff: String(row.dropoff), scheduledFor: new Date(row.scheduled_for as string) };
  await writeCabAudit(actor, "ride_assigned", { rideId: id, subject: subject(ride), details: { driver: row.driver_name, vehicle: row.number_plate } });
  await rideAssigned(ride, { userId: String(row.requested_by_id), email: String(row.requested_by_email) },
    { ...(await driverPerson(String(row.driver_email))), name: String(row.driver_name) }, { plate: String(row.number_plate), model: String(row.model) });
}

/** The assigned driver sets off. Only their own ride, only from assigned. */
export async function startRide(id: string, driver: Pick<CabUser, "id" | "name" | "driverId">): Promise<void> {
  if (!driver.driverId) throw new CabsError("Not allowed.", 403);
  const [row] = rows<{ pickup: string; dropoff: string }>(await db.execute(sql`
    update cab_rides set status = 'in_progress', started_at = now(), updated_at = now()
    where id = ${id} and status = 'assigned' and driver_id = ${driver.driverId} returning pickup, dropoff`));
  if (!row) return whyNot(id, "start", { driverId: driver.driverId });
  await writeCabAudit(driver, "ride_started", { rideId: id, subject: subject(row) });
}

/** The assigned driver has dropped the person off. Only their own ride, only from in_progress. */
export async function completeRide(id: string, driver: Pick<CabUser, "id" | "name" | "driverId">): Promise<void> {
  if (!driver.driverId) throw new CabsError("Not allowed.", 403);
  const [row] = rows<Record<string, unknown>>(await db.execute(sql`
    update cab_rides set status = 'completed', completed_at = now(), updated_at = now()
    where id = ${id} and status = 'in_progress' and driver_id = ${driver.driverId}
    returning pickup, dropoff, scheduled_for, requested_by_id, requested_by_email`));
  if (!row) return whyNot(id, "complete", { driverId: driver.driverId });
  const ride = { id, pickup: String(row.pickup), dropoff: String(row.dropoff), scheduledFor: new Date(row.scheduled_for as string) };
  await writeCabAudit(driver, "ride_completed", { rideId: id, subject: subject(ride) });
  await rideCompleted(ride, { userId: String(row.requested_by_id), email: String(row.requested_by_email) });
}

/**
 * Cancels a ride. The person who booked it may cancel it while it is pending (no reason needed). An admin may cancel any pending or
 * assigned ride, with a reason, which the person (and the driver, if one was assigned) is told.
 */
export async function cancelRide(id: string, actor: Actor, opts: { asAdmin: boolean; reason: string | null }): Promise<void> {
  if (opts.asAdmin && !opts.reason) throw new CabsError("Give a reason for cancelling.");
  const who = opts.asAdmin ? sql`status in ('pending', 'assigned')` : sql`status = 'pending' and requested_by_id = ${actor.id}`;
  const [row] = rows<Record<string, unknown>>(await db.execute(sql`
    with r as (
      update cab_rides set status = 'cancelled', cancelled_at = now(), cancelled_by_name = ${actor.name}, cancel_reason = ${opts.reason}, updated_at = now()
      where id = ${id} and ${who}
      returning pickup, dropoff, scheduled_for, requested_by_id, requested_by_email, driver_id)
    select r.*, d.email as driver_email from r left join cab_drivers d on d.id = r.driver_id`));
  if (!row) {
    const ride = await getRide(id);
    if (!ride || (!opts.asAdmin && ride.requestedById !== actor.id)) throw new CabsError("That ride no longer exists. Reload and try again.", 404);
    if (!opts.asAdmin && ride.status !== "cancelled") throw new CabsError(`This ride is ${ride.status.replace("_", " ")}: only a pending ride can be cancelled here. Ask a Cabs admin.`, 409);
    return whyNot(id, "cancel");
  }
  const ride = { id, pickup: String(row.pickup), dropoff: String(row.dropoff), scheduledFor: new Date(row.scheduled_for as string) };
  await writeCabAudit(actor, "ride_cancelled", { rideId: id, subject: subject(ride), details: { reason: opts.reason, byAdmin: opts.asAdmin } });
  if (opts.asAdmin) {
    const driver = row.driver_email ? await driverPerson(String(row.driver_email)) : null;
    await rideCancelledByAdmin(ride, { userId: String(row.requested_by_id), email: String(row.requested_by_email) }, opts.reason!, driver);
  }
}

/** The admin dashboard's figures: rides waiting, today's rides (India time), running now, and the fleet. */
export async function adminStats(): Promise<{ pending: number; today: number; inProgress: number; vehicles: number; drivers: number; available: number }> {
  const [x] = rows<Record<string, number>>(await db.execute(sql`
    select (select count(*) from cab_rides where status = 'pending')::int as pending,
      (select count(*) from cab_rides where status <> 'cancelled'
        and (scheduled_for at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date)::int as today,
      (select count(*) from cab_rides where status = 'in_progress')::int as in_progress,
      (select count(*) from cab_vehicles where is_active)::int as vehicles,
      (select count(*) from cab_drivers)::int as drivers,
      (select count(*) from cab_drivers where is_available)::int as available`));
  return { pending: x.pending, today: x.today, inProgress: x.in_progress, vehicles: x.vehicles, drivers: x.drivers, available: x.available };
}

/** Available drivers, for assigning a ride (with their usual vehicle, offered first). */
export async function availableDrivers(): Promise<{ id: string; name: string; vehicleId: string | null }[]> {
  return rows<{ id: string; name: string; vehicle_id: string | null }>(await db.execute(sql`select id, name, vehicle_id from cab_drivers where is_available order by name`))
    .map((d) => ({ id: d.id, name: d.name, vehicleId: d.vehicle_id }));
}
