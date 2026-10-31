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
 * needed. A driver signs in to Cabs Driver with their phone and a code an admin gives them (driver-session.ts); someone signed in to the
 * hub with a driver's email opens it too (host-adapter.ts). A driver has no car of their own: the car is chosen for each ride. Removing a
 * driver ends their sign-ins; their past rides keep the driver's name, taken when each ride was assigned.
 */

type Actor = Pick<CabUser, "id" | "name">;
const rows = <T,>(res: unknown) => (res as { rows: T[] }).rows;

/** `loginRequestedAt`: when they asked for a login OTP, if within the last 24 hours and not answered yet. */
export type DriverRow = { id: string; name: string; email: string | null; phone: string; isAvailable: boolean; upcoming: number; loginRequestedAt: Date | null };

export async function listDrivers(): Promise<DriverRow[]> {
  const r = rows<Record<string, unknown>>(await db.execute(sql`
    select d.id, d.name, d.email, d.phone, d.is_available,
      case when d.login_requested_at > now() - interval '24 hours' then d.login_requested_at end as login_requested_at,
      (select count(*) from cab_rides r where r.driver_id = d.id and r.status in ('assigned', 'in_progress'))::int as upcoming
    from cab_drivers d order by d.name`));
  return r.map((x) => ({ id: String(x.id), name: String(x.name), email: (x.email as string) ?? null, phone: String(x.phone), isAvailable: !!x.is_available, upcoming: Number(x.upcoming),
    loginRequestedAt: x.login_requested_at ? new Date(x.login_requested_at as string) : null }));
}

/** Adds a driver. One statement; a phone (or email) that is already a driver's is refused. */
export async function createDriver(input: z.infer<typeof driverInput>, actor: Actor): Promise<{ id: string }> {
  const [row] = rows<{ id: string }>(await db.execute(sql`
    insert into cab_drivers (name, email, phone) values (${input.name}, ${input.email}, ${input.phone})
    on conflict do nothing returning id`));
  if (!row) {
    const [taken] = rows<{ name: string; phone: string }>(await db.execute(sql`
      select name, phone from cab_drivers where phone = ${input.phone} or (${input.email}::text is not null and email = ${input.email}) limit 1`));
    throw new CabsError(taken?.phone === input.phone ? `${taken.name} already has the phone number ${input.phone}.` : `${input.email} is already a driver.`, 409);
  }
  await writeCabAudit(actor, "driver_added", { subject: input.name, details: { email: input.email, phone: input.phone } });
  return row;
}

/**
 * Edits a driver's name, phone and email (one statement). A phone or email that is another driver's is refused. Their rides keep the name
 * they had when each was assigned.
 */
export async function updateDriver(id: string, input: z.infer<typeof driverInput>, actor: Actor): Promise<void> {
  const [row] = rows<{ name: string; phone: string; email: string | null; old_name: string; old_phone: string; old_email: string | null }>(await db.execute(sql`
    with old as (select name, phone, email from cab_drivers where id = ${id})
    update cab_drivers d set name = ${input.name}, phone = ${input.phone}, email = ${input.email}
    from old where d.id = ${id}
      and not exists (select 1 from cab_drivers o where o.id <> ${id} and (o.phone = ${input.phone} or (${input.email}::text is not null and o.email = ${input.email})))
    returning d.name, d.phone, d.email, old.name as old_name, old.phone as old_phone, old.email as old_email`));
  if (!row) {
    const [taken] = rows<{ name: string; phone: string }>(await db.execute(sql`
      select name, phone from cab_drivers where id <> ${id} and (phone = ${input.phone} or (${input.email}::text is not null and email = ${input.email})) limit 1`));
    if (taken) throw new CabsError(taken.phone === input.phone ? `${taken.name} already has the phone number ${input.phone}.` : `${input.email} is already a driver.`, 409);
    throw new CabsError("That driver no longer exists. Reload and try again.", 404);
  }
  const changes = Object.fromEntries((["name", "phone", "email"] as const).filter((k) => row[k] !== row[`old_${k}`]).map((k) => [k, `${row[`old_${k}`] ?? "none"} → ${row[k] ?? "none"}`]));
  await writeCabAudit(actor, "driver_edited", { subject: row.name, details: changes });
}

export async function setAvailability(id: string, available: boolean, actor: Actor & Partial<Pick<CabUser, "via">>): Promise<void> {
  const [row] = rows<{ name: string }>(await db.execute(sql`update cab_drivers set is_available = ${available} where id = ${id} returning name`));
  if (!row) throw new CabsError("That driver no longer exists. Reload and try again.", 404);
  await writeCabAudit(actor, "driver_availability", { subject: row.name, details: { available } });
}

/** A driver goes online or offline themselves (the Online/Offline switch on their page). Offline: no new rides are assigned to them. */
export async function setOwnAvailability(driver: Pick<CabUser, "id" | "name" | "driverId" | "via">, available: boolean): Promise<void> {
  if (!driver.driverId) throw new CabsError("Only drivers go online or offline.", 403);
  await setAvailability(driver.driverId, available, driver);
}

export type DriverProfile = { name: string; email: string | null; phone: string; isAvailable: boolean; vehiclePlate: string | null; vehicleModel: string | null; completed: number };

/**
 * A driver's own details for their Profile tab: who they are, the car of their current ride (the one under way, else their next assigned
 * one; drivers have no car of their own), and how many rides they have completed.
 */
export async function driverProfile(driverId: string): Promise<DriverProfile | null> {
  const [x] = rows<Record<string, unknown>>(await db.execute(sql`
    select d.name, d.email, d.phone, d.is_available, cr.vehicle_plate as number_plate, v.model,
      (select count(*) from cab_rides r where r.driver_id = d.id and r.status = 'completed')::int as completed
    from cab_drivers d
    left join lateral (select vehicle_id, vehicle_plate from cab_rides where driver_id = d.id and status in ('in_progress', 'assigned')
      order by (status = 'in_progress') desc, scheduled_for limit 1) cr on true
    left join cab_vehicles v on v.id = cr.vehicle_id
    where d.id = ${driverId}`));
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
