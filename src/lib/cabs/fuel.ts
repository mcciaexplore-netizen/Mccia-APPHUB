import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { writeCabAudit } from "./audit";
import { CabsError } from "./errors";
import type { CabUser } from "./host-adapter";
import { istDayStart, type FuelInput } from "./validation";

/** Fuel bought for the vehicles, recorded and deleted by Cabs admins on Payments. The plate is copied in when a record is made. */

type Actor = Pick<CabUser, "id" | "name">;
const rows = <T,>(res: unknown) => (res as { rows: T[] }).rows;
const isDay = (d: string | undefined): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
const isId = (v: string | undefined): v is string => !!v && /^[0-9a-f-]{36}$/i.test(v);

export type FuelRow = { id: string; vehicleId: string; vehiclePlate: string; litres: string; costPaise: number; fuelledAt: Date; stationName: string | null; recordedByName: string };
export type FuelFilter = { vehicleId?: string; from?: string; to?: string };

/** Records, newest first, filtered by vehicle and the day the fuel was bought (India time, both ends included). */
export async function listFuel(f: FuelFilter = {}, limit = 500): Promise<FuelRow[]> {
  const c: SQL[] = [sql`true`];
  if (isId(f.vehicleId)) c.push(sql`vehicle_id = ${f.vehicleId}`);
  if (isDay(f.from)) c.push(sql`fuelled_at >= ${istDayStart(f.from)}`);
  if (isDay(f.to)) c.push(sql`fuelled_at < ${new Date(istDayStart(f.to).getTime() + 86_400_000)}`);
  return rows<Record<string, unknown>>(await db.execute(sql`
    select * from cab_fuel_costs where ${sql.join(c, sql` and `)} order by fuelled_at desc, created_at desc limit ${limit}`)).map((x) => ({
    id: String(x.id), vehicleId: String(x.vehicle_id), vehiclePlate: String(x.vehicle_plate), litres: String(x.litres), costPaise: Number(x.cost_paise),
    fuelledAt: new Date(x.fuelled_at as string), stationName: (x.station_name as string) ?? null, recordedByName: String(x.recorded_by_name),
  }));
}

/** This month's fuel (India time): what it cost and how many litres. */
export async function fuelThisMonth(): Promise<{ costPaise: number; litres: number }> {
  const [r] = rows<{ cost: number; litres: string }>(await db.execute(sql`
    select coalesce(sum(cost_paise), 0)::int as cost, coalesce(sum(litres), 0)::text as litres from cab_fuel_costs
    where date_trunc('month', fuelled_at at time zone 'Asia/Kolkata') = date_trunc('month', now() at time zone 'Asia/Kolkata')`));
  return { costPaise: Number(r?.cost ?? 0), litres: Number(r?.litres ?? 0) };
}

/** Records fuel for an active vehicle (one statement: the plate is copied in from the vehicle, which must be active). "Added by" is the admin. */
export async function addFuel(v: FuelInput, actor: Actor): Promise<{ id: string }> {
  const [row] = rows<{ id: string; vehicle_plate: string }>(await db.execute(sql`
    insert into cab_fuel_costs (vehicle_id, vehicle_plate, litres, cost_paise, fuelled_at, station_name, recorded_by_id, recorded_by_name)
    select id, number_plate, ${v.litres}::numeric, ${v.cost}, ${v.fuelledAt}, ${v.stationName}, ${actor.id}, ${actor.name}
    from cab_vehicles where id = ${v.vehicleId} and is_active
    returning id, vehicle_plate`));
  if (!row) throw new CabsError("Choose an active vehicle. Reload and try again.", 409);
  await writeCabAudit(actor, "fuel_recorded", { subject: row.vehicle_plate, details: { litres: v.litres, cost: v.cost, fuelledAt: v.fuelledAt.toISOString(), station: v.stationName } });
  return { id: row.id };
}

/** Deletes a record entered by mistake. */
export async function deleteFuel(id: string, actor: Actor): Promise<void> {
  const [row] = rows<{ vehicle_plate: string; litres: string; cost_paise: number }>(await db.execute(sql`
    delete from cab_fuel_costs where id = ${id} returning vehicle_plate, litres::text, cost_paise`));
  if (!row) throw new CabsError("That record no longer exists. Reload and try again.", 404);
  await writeCabAudit(actor, "fuel_deleted", { subject: row.vehicle_plate, details: { litres: row.litres, cost: row.cost_paise } });
}
