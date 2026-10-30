import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { writeCabAudit } from "./audit";
import { MAINTENANCE_TYPES, type MaintenanceType } from "./cabs.manifest";
import { CabsError } from "./errors";
import type { CabUser } from "./host-adapter";
import { istDayStart, type MaintenanceInput } from "./validation";

/** Vehicle maintenance records: added, edited and deleted by Cabs admins. The plate is copied in when a record is made. */

type Actor = Pick<CabUser, "id" | "name">;
const rows = <T,>(res: unknown) => (res as { rows: T[] }).rows;
const date = (v: unknown) => (v == null ? null : new Date(v as string));

export type MaintenanceRow = {
  id: string; vehicleId: string; vehiclePlate: string; type: MaintenanceType; description: string; costPaise: number | null; doneAt: Date; doneBy: string;
  nextDueAt: Date | null; notes: string | null; recordedByName: string;
};
export type MaintenanceFilter = { vehicleId?: string; type?: string; from?: string; to?: string };

const isDay = (d: string | undefined): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
const isId = (v: string | undefined): v is string => !!v && /^[0-9a-f-]{36}$/i.test(v);

/** Records, newest work first, filtered by vehicle, type and the day the work was done (India time, both ends included). */
export async function listMaintenance(f: MaintenanceFilter = {}, limit = 500): Promise<MaintenanceRow[]> {
  const c: SQL[] = [sql`true`];
  if (isId(f.vehicleId)) c.push(sql`m.vehicle_id = ${f.vehicleId}`);
  if (f.type && (MAINTENANCE_TYPES as readonly string[]).includes(f.type)) c.push(sql`m.type = ${f.type}`);
  if (isDay(f.from)) c.push(sql`m.done_at >= ${istDayStart(f.from)}`);
  if (isDay(f.to)) c.push(sql`m.done_at < ${new Date(istDayStart(f.to).getTime() + 86_400_000)}`);
  return rows<Record<string, unknown>>(await db.execute(sql`
    select m.* from cab_maintenance m where ${sql.join(c, sql` and `)} order by m.done_at desc, m.created_at desc limit ${limit}`)).map((x) => ({
    id: String(x.id), vehicleId: String(x.vehicle_id), vehiclePlate: String(x.vehicle_plate), type: x.type as MaintenanceType, description: String(x.description),
    costPaise: x.cost_paise == null ? null : Number(x.cost_paise), doneAt: new Date(x.done_at as string), doneBy: String(x.done_by), nextDueAt: date(x.next_due_at),
    notes: (x.notes as string) ?? null, recordedByName: String(x.recorded_by_name),
  }));
}

const values = (v: MaintenanceInput) => ({ doneAt: istDayStart(v.doneAt), nextDueAt: v.nextDueAt ? istDayStart(v.nextDueAt) : null });

/** Adds a record for an active vehicle (one statement: the plate is copied in from the vehicle, which must be active). */
export async function addMaintenance(v: MaintenanceInput, actor: Actor): Promise<{ id: string }> {
  const t = values(v);
  const [row] = rows<{ id: string; vehicle_plate: string }>(await db.execute(sql`
    insert into cab_maintenance (vehicle_id, vehicle_plate, type, description, cost_paise, done_at, done_by, next_due_at, notes, recorded_by_id, recorded_by_name)
    select id, number_plate, ${v.type}, ${v.description}, ${v.cost}, ${t.doneAt}, ${v.doneBy}, ${t.nextDueAt}, ${v.notes}, ${actor.id}, ${actor.name}
    from cab_vehicles where id = ${v.vehicleId} and is_active
    returning id, vehicle_plate`));
  if (!row) throw new CabsError("Choose an active vehicle. Reload and try again.", 409);
  await writeCabAudit(actor, "maintenance_added", { subject: row.vehicle_plate, details: { type: v.type, description: v.description, cost: v.cost, doneAt: v.doneAt, nextDueAt: v.nextDueAt } });
  return { id: row.id };
}

/** Edits a record. Moving it to another vehicle copies that vehicle's plate (any vehicle, so history can be corrected). */
export async function editMaintenance(id: string, v: MaintenanceInput, actor: Actor): Promise<void> {
  const t = values(v);
  const [row] = rows<{ vehicle_plate: string }>(await db.execute(sql`
    update cab_maintenance m set vehicle_id = veh.id, vehicle_plate = veh.number_plate, type = ${v.type}, description = ${v.description}, cost_paise = ${v.cost},
      done_at = ${t.doneAt}, done_by = ${v.doneBy}, next_due_at = ${t.nextDueAt}, notes = ${v.notes}
    from cab_vehicles veh where m.id = ${id} and veh.id = ${v.vehicleId}
    returning m.vehicle_plate`));
  if (!row) throw new CabsError("That record or vehicle no longer exists. Reload and try again.", 404);
  await writeCabAudit(actor, "maintenance_edited", { subject: row.vehicle_plate, details: { type: v.type, description: v.description, cost: v.cost, doneAt: v.doneAt, nextDueAt: v.nextDueAt } });
}

export async function deleteMaintenance(id: string, actor: Actor): Promise<void> {
  const [row] = rows<{ vehicle_plate: string; type: string; description: string }>(await db.execute(sql`delete from cab_maintenance where id = ${id} returning vehicle_plate, type, description`));
  if (!row) throw new CabsError("That record no longer exists. Reload and try again.", 404);
  await writeCabAudit(actor, "maintenance_deleted", { subject: row.vehicle_plate, details: { type: row.type, description: row.description } });
}

/** Each vehicle's latest maintenance and the next due date that record set, for the Vehicles page. */
export async function maintenanceByVehicle(): Promise<Map<string, { lastAt: Date; nextDueAt: Date | null }>> {
  const r = rows<{ vehicle_id: string; done_at: string; next_due_at: string | null }>(await db.execute(sql`
    select distinct on (vehicle_id) vehicle_id, done_at, next_due_at from cab_maintenance order by vehicle_id, done_at desc, created_at desc`));
  return new Map(r.map((x) => [x.vehicle_id, { lastAt: new Date(x.done_at), nextDueAt: date(x.next_due_at) }]));
}
