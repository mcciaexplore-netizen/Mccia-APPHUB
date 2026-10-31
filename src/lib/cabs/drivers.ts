import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { writeCabAudit } from "./audit";
import { CabsError } from "./errors";
import { hasRole, type CabUser } from "./host-adapter";
import type { driverInput } from "./validation";
import type { z } from "zod";

/**
 * Drivers, added on Cabs Admin → Drivers: a name and a phone number (one driver per phone), and optionally an email, with no hub account
 * needed. Someone signed in to the hub with a driver's email opens Cabs Driver (see host-adapter.ts); a driver without one cannot, and a
 * Cabs admin starts and completes their rides. Removing a driver ends that; their past rides keep the driver's name,
 * taken when each ride was assigned.
 */

type Actor = Pick<CabUser, "id" | "name">;
const rows = <T,>(res: unknown) => (res as { rows: T[] }).rows;

export type DriverRow = {
  id: string; name: string; email: string | null; phone: string; isAvailable: boolean; vehicleId: string | null; vehiclePlate: string | null; vehicleModel: string | null;
  vehicleActive: boolean | null; upcoming: number;
};

export async function listDrivers(): Promise<DriverRow[]> {
  const r = rows<Record<string, unknown>>(await db.execute(sql`
    select d.id, d.name, d.email, d.phone, d.is_available, d.vehicle_id, v.number_plate, v.model, v.is_active,
      (select count(*) from cab_rides r where r.driver_id = d.id and r.status in ('assigned', 'in_progress'))::int as upcoming
    from cab_drivers d left join cab_vehicles v on v.id = d.vehicle_id
    order by d.name`));
  return r.map((x) => ({
    id: String(x.id), name: String(x.name), email: (x.email as string) ?? null, phone: String(x.phone), isAvailable: !!x.is_available,
    vehicleId: (x.vehicle_id as string) ?? null, vehiclePlate: (x.number_plate as string) ?? null, vehicleModel: (x.model as string) ?? null,
    vehicleActive: x.is_active == null ? null : !!x.is_active, upcoming: Number(x.upcoming),
  }));
}

/** Why a vehicle cannot be given to a driver, after a statement that required it came back empty. */
async function vehicleProblem(vehicleId: string | null): Promise<string | null> {
  if (!vehicleId) return null;
  const [v] = rows<{ is_active: boolean }>(await db.execute(sql`select is_active from cab_vehicles where id = ${vehicleId}`));
  return !v ? "That vehicle no longer exists. Reload and try again." : !v.is_active ? "That vehicle is inactive. Choose an active one." : null;
}

/** Adds a driver, optionally with a vehicle (which must be active). One statement; a phone (or email) that is already a driver's is refused. */
export async function createDriver(input: z.infer<typeof driverInput>, actor: Actor): Promise<{ id: string }> {
  const [row] = rows<{ id: string }>(await db.execute(sql`
    insert into cab_drivers (name, email, phone, vehicle_id)
    select ${input.name}, ${input.email}, ${input.phone}, ${input.vehicleId}::uuid
    where ${input.vehicleId}::uuid is null or exists (select 1 from cab_vehicles where id = ${input.vehicleId}::uuid and is_active)
    on conflict do nothing returning id`));
  if (!row) {
    const problem = await vehicleProblem(input.vehicleId);
    if (problem) throw new CabsError(problem, 409);
    const [taken] = rows<{ name: string; phone: string }>(await db.execute(sql`
      select name, phone from cab_drivers where phone = ${input.phone} or (${input.email}::text is not null and email = ${input.email}) limit 1`));
    throw new CabsError(taken?.phone === input.phone ? `${taken.name} already has the phone number ${input.phone}.` : `${input.email} is already a driver.`, 409);
  }
  await writeCabAudit(actor, "driver_added", { subject: input.name, details: { email: input.email, phone: input.phone, vehicleId: input.vehicleId } });
  return row;
}

/** Gives a driver a vehicle (active only), or none. */
export async function updateDriver(id: string, input: { vehicleId: string | null }, actor: Actor): Promise<void> {
  const [row] = rows<{ name: string; number_plate: string | null }>(await db.execute(sql`
    update cab_drivers d set vehicle_id = ${input.vehicleId}::uuid
    where d.id = ${id} and (${input.vehicleId}::uuid is null or exists (select 1 from cab_vehicles where id = ${input.vehicleId}::uuid and is_active))
    returning d.name, (select number_plate from cab_vehicles where id = ${input.vehicleId}::uuid) as number_plate`));
  if (!row) {
    const problem = await vehicleProblem(input.vehicleId);
    throw new CabsError(problem ?? "That driver no longer exists. Reload and try again.", problem ? 409 : 404);
  }
  await writeCabAudit(actor, "driver_updated", { subject: row.name, details: { vehicle: row.number_plate ?? "none" } });
}

export async function setAvailability(id: string, available: boolean, actor: Actor): Promise<void> {
  const [row] = rows<{ name: string }>(await db.execute(sql`update cab_drivers set is_available = ${available} where id = ${id} returning name`));
  if (!row) throw new CabsError("That driver no longer exists. Reload and try again.", 404);
  await writeCabAudit(actor, "driver_availability", { subject: row.name, details: { available } });
}

/** A driver goes online or offline themselves (the Online/Offline switch on their page). Offline: no new rides are assigned to them. */
export async function setOwnAvailability(driver: Pick<CabUser, "id" | "name" | "driverId">, available: boolean): Promise<void> {
  if (!driver.driverId) throw new CabsError("Only drivers go online or offline.", 403);
  await setAvailability(driver.driverId, available, driver);
}

export type DriverProfile = { name: string; email: string | null; phone: string; isAvailable: boolean; vehiclePlate: string | null; vehicleModel: string | null; completed: number };

/** A driver's own details for their Profile tab: who they are, their vehicle, and how many rides they have completed. */
export async function driverProfile(driverId: string): Promise<DriverProfile | null> {
  const [x] = rows<Record<string, unknown>>(await db.execute(sql`
    select d.name, d.email, d.phone, d.is_available, v.number_plate, v.model,
      (select count(*) from cab_rides r where r.driver_id = d.id and r.status = 'completed')::int as completed
    from cab_drivers d left join cab_vehicles v on v.id = d.vehicle_id where d.id = ${driverId}`));
  return x ? { name: String(x.name), email: (x.email as string) ?? null, phone: String(x.phone), isAvailable: !!x.is_available, vehiclePlate: (x.number_plate as string) ?? null,
    vehicleModel: (x.model as string) ?? null, completed: Number(x.completed) } : null;
}

export type ViewedDriver = { driverId: string | null; name: string; preview: boolean };

/**
 * Which driver a driver-app page shows. A driver: themselves. A Cabs admin may pick any driver (?driver=<id>) to see the app as that driver
 * would ("preview": nothing can be done from it); without a pick, an admin who is also a driver sees their own, and one who is not sees none.
 */
export async function viewedDriver(user: Pick<CabUser, "roles" | "driverId" | "name">, raw: string | undefined): Promise<ViewedDriver> {
  if (hasRole(user, "cab_admin") && raw && /^[0-9a-f-]{36}$/i.test(raw) && raw !== user.driverId) {
    const [d] = rows<{ id: string; name: string }>(await db.execute(sql`select id, name from cab_drivers where id = ${raw}`));
    if (d) return { driverId: d.id, name: d.name, preview: true };
  }
  return { driverId: user.driverId, name: user.name, preview: false };
}

/** Removes a driver, unless they have an assigned or running ride (one statement, so a ride cannot be assigned in between). */
export async function removeDriver(id: string, actor: Actor): Promise<void> {
  const [row] = rows<{ name: string; email: string | null }>(await db.execute(sql`
    delete from cab_drivers d where d.id = ${id} and not exists (select 1 from cab_rides r where r.driver_id = ${id} and r.status in ('assigned', 'in_progress'))
    returning d.name, d.email`));
  if (!row) {
    const [d] = rows<{ id: string }>(await db.execute(sql`select id from cab_drivers where id = ${id}`));
    if (!d) throw new CabsError("That driver no longer exists. Reload and try again.", 404);
    throw new CabsError("This driver has assigned or running rides. Reassign or finish them first.", 409);
  }
  await writeCabAudit(actor, "driver_removed", { subject: row.name, details: { email: row.email } });
}
