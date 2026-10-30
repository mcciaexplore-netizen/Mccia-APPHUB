import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { writeCabAudit } from "./audit";
import { CabsError } from "./errors";
import type { CabUser } from "./host-adapter";
import type { vehicleInput, vehicleUpdate } from "./validation";
import type { z } from "zod";

/** The fleet. Vehicles are deactivated, never deleted, so past rides keep naming them. */

type Actor = Pick<CabUser, "id" | "name">;
const rows = <T,>(res: unknown) => (res as { rows: T[] }).rows;
const pgCode = (e: unknown) => (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
const DUPLICATE = "A vehicle with that number plate already exists.";

export type VehicleRow = { id: string; numberPlate: string; model: string; capacity: number; isActive: boolean; drivers: string | null; activeRides: number };

export async function listVehicles(): Promise<VehicleRow[]> {
  const r = rows<Record<string, unknown>>(await db.execute(sql`
    select v.id, v.number_plate, v.model, v.capacity, v.is_active,
      (select string_agg(d.name, ', ' order by d.name) from cab_drivers d where d.vehicle_id = v.id) as drivers,
      (select count(*) from cab_rides r where r.vehicle_id = v.id and r.status in ('assigned', 'in_progress'))::int as active_rides
    from cab_vehicles v order by v.is_active desc, v.number_plate`));
  return r.map((x) => ({ id: String(x.id), numberPlate: String(x.number_plate), model: String(x.model), capacity: Number(x.capacity), isActive: !!x.is_active, drivers: (x.drivers as string) ?? null, activeRides: Number(x.active_rides) }));
}

/** Active vehicles, for assigning a ride and a driver's car. */
export async function activeVehicles(): Promise<{ id: string; numberPlate: string; model: string; capacity: number }[]> {
  return (await listVehicles()).filter((v) => v.isActive).map(({ id, numberPlate, model, capacity }) => ({ id, numberPlate, model, capacity }));
}

export async function createVehicle(v: z.infer<typeof vehicleInput>, actor: Actor): Promise<{ id: string }> {
  const [row] = rows<{ id: string }>(await db.execute(sql`
    insert into cab_vehicles (number_plate, model, capacity) values (${v.numberPlate}, ${v.model}, ${v.capacity})
    on conflict (number_plate) do nothing returning id`));
  if (!row) throw new CabsError(DUPLICATE, 409);
  await writeCabAudit(actor, "vehicle_added", { subject: v.numberPlate, details: { model: v.model, seats: v.capacity } });
  return row;
}

/** Edits a vehicle (and can make an inactive one active again). Only what is sent changes. */
export async function updateVehicle(id: string, v: z.infer<typeof vehicleUpdate>, actor: Actor): Promise<void> {
  let row: { number_plate: string } | undefined;
  try {
    [row] = rows<{ number_plate: string }>(await db.execute(sql`
      update cab_vehicles set number_plate = coalesce(${v.numberPlate ?? null}, number_plate), model = coalesce(${v.model ?? null}, model),
        capacity = coalesce(${v.capacity ?? null}::int, capacity), is_active = coalesce(${v.isActive ?? null}::boolean, is_active)
      where id = ${id} returning number_plate`));
  } catch (e) {
    if (pgCode(e) === "23505") throw new CabsError(DUPLICATE, 409);
    throw e;
  }
  if (!row) throw new CabsError("That vehicle no longer exists. Reload and try again.", 404);
  await writeCabAudit(actor, "vehicle_updated", { subject: row.number_plate, details: { ...v } });
}

/** Takes a vehicle out of the fleet, unless it is on an assigned or running ride right now (one statement, so a ride cannot slip in). */
export async function deactivateVehicle(id: string, actor: Actor): Promise<void> {
  const [row] = rows<{ number_plate: string }>(await db.execute(sql`
    update cab_vehicles set is_active = false
    where id = ${id} and is_active and not exists (select 1 from cab_rides r where r.vehicle_id = ${id} and r.status in ('assigned', 'in_progress'))
    returning number_plate`));
  if (!row) {
    const [v] = rows<{ is_active: boolean }>(await db.execute(sql`select is_active from cab_vehicles where id = ${id}`));
    if (!v) throw new CabsError("That vehicle no longer exists. Reload and try again.", 404);
    if (!v.is_active) throw new CabsError("That vehicle is already inactive.", 409);
    throw new CabsError("This vehicle is on an assigned or running ride. Reassign or finish it first.", 409);
  }
  await writeCabAudit(actor, "vehicle_deactivated", { subject: row.number_plate });
}
