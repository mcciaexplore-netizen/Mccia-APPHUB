import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { writeCabAudit } from "./audit";
import { CabsError } from "./errors";
import type { CabUser } from "./host-adapter";
import { formatRupees } from "./money";

/**
 * What rides cost. Only a completed ride gets a cost; it can be changed until the invoice that billed it is sent (a draft invoice's total
 * follows the change, in the same statement).
 */

type Actor = Pick<CabUser, "id" | "name">;
const rows = <T,>(res: unknown) => (res as { rows: T[] }).rows;
const isDay = (d: string | undefined): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);

export type CostedRide = {
  rideId: string; completedAt: Date | null; requestedByName: string; branch: string | null; pickup: string; dropoff: string; driverName: string | null;
  farePaise: number | null; distanceKm: number | null; costNotes: string | null; recordedByName: string | null; invoiceNumber: string | null; invoiceStatus: string | null;
};
export type PaymentFilter = { from?: string; to?: string; branch?: string; missing?: boolean };

/** Completed rides with their cost (or none yet), newest first, by completion day (India time) and branch. `missing`: only those without a cost. */
export async function listCostedRides(f: PaymentFilter = {}, limit = 500): Promise<CostedRide[]> {
  const c: SQL[] = [sql`r.status = 'completed'`];
  if (isDay(f.from)) c.push(sql`(r.completed_at at time zone 'Asia/Kolkata')::date >= ${f.from}::date`);
  if (isDay(f.to)) c.push(sql`(r.completed_at at time zone 'Asia/Kolkata')::date <= ${f.to}::date`);
  if (f.branch) c.push(sql`r.requested_by_branch = ${f.branch}`);
  if (f.missing) c.push(sql`c.id is null`);
  return rows<Record<string, unknown>>(await db.execute(sql`
    select r.id as ride_id, r.completed_at, r.requested_by_name, r.requested_by_branch, r.pickup, r.dropoff, r.driver_name,
      c.base_fare_paise, c.distance_km, c.notes as cost_notes, c.recorded_by_name, i.invoice_number, i.status as invoice_status
    from cab_rides r left join cab_ride_costs c on c.ride_id = r.id left join cab_invoices i on i.id = c.invoice_id
    where ${sql.join(c, sql` and `)} order by r.completed_at desc nulls last limit ${limit}`)).map((x) => ({
    rideId: String(x.ride_id), completedAt: x.completed_at ? new Date(x.completed_at as string) : null, requestedByName: String(x.requested_by_name),
    branch: (x.requested_by_branch as string) ?? null, pickup: String(x.pickup), dropoff: String(x.dropoff), driverName: (x.driver_name as string) ?? null,
    farePaise: x.base_fare_paise == null ? null : Number(x.base_fare_paise), distanceKm: x.distance_km == null ? null : Number(x.distance_km), costNotes: (x.cost_notes as string) ?? null,
    recordedByName: (x.recorded_by_name as string) ?? null, invoiceNumber: (x.invoice_number as string) ?? null, invoiceStatus: (x.invoice_status as string) ?? null,
  }));
}

/** The figures at the top of Payments: this month (India time) — total cost, rides costed, average per ride. */
export async function paymentSummary(): Promise<{ monthPaise: number; monthRides: number; avgPaise: number | null }> {
  const [x] = rows<{ total: string | null; n: number }>(await db.execute(sql`
    select sum(c.base_fare_paise)::bigint as total, count(*)::int as n from cab_ride_costs c join cab_rides r on r.id = c.ride_id
    where date_trunc('month', r.completed_at at time zone 'Asia/Kolkata') = date_trunc('month', now() at time zone 'Asia/Kolkata')`));
  const total = Number(x.total ?? 0);
  return { monthPaise: total, monthRides: x.n, avgPaise: x.n ? Math.round(total / x.n) : null };
}

/**
 * Records a completed ride's cost, or changes it. A new cost: one insert that only happens for a completed ride. A change: refused once
 * the ride's invoice has been sent; while it is a draft, the invoice's total moves by the difference in the same statement.
 */
export async function saveCost(rideId: string, v: { fare: number | null; distanceKm: number | null; notes: string | null }, actor: Actor): Promise<"recorded" | "changed"> {
  const fare = v.fare ?? 0;
  const [added] = rows<{ pickup: string; dropoff: string }>(await db.execute(sql`
    with r as (select id, pickup, dropoff from cab_rides where id = ${rideId} and status = 'completed'),
    ins as (
      insert into cab_ride_costs (ride_id, base_fare_paise, distance_km, notes, recorded_by_id, recorded_by_name)
      select id, ${fare}, ${v.distanceKm}, ${v.notes}, ${actor.id}, ${actor.name} from r
      on conflict (ride_id) do nothing returning ride_id)
    select r.pickup, r.dropoff from r join ins on ins.ride_id = r.id`));
  if (added) {
    await writeCabAudit(actor, "cost_recorded", { rideId, subject: `${added.pickup} → ${added.dropoff}`, details: { fare: formatRupees(fare), distanceKm: v.distanceKm } });
    return "recorded";
  }
  const [changed] = rows<{ before: number; pickup: string; dropoff: string }>(await db.execute(sql`
    with old as (
      select c.id, c.base_fare_paise, c.invoice_id from cab_ride_costs c left join cab_invoices i on i.id = c.invoice_id
      where c.ride_id = ${rideId} and (c.invoice_id is null or i.status = 'draft') for update of c),
    upd as (
      update cab_ride_costs c set base_fare_paise = ${fare}, distance_km = ${v.distanceKm}, notes = ${v.notes}, recorded_by_id = ${actor.id}, recorded_by_name = ${actor.name}
      from old where c.id = old.id returning old.base_fare_paise as before, old.invoice_id),
    inv as (update cab_invoices i set total_amount_paise = i.total_amount_paise + ${fare} - upd.before from upd where i.id = upd.invoice_id and i.status = 'draft' returning 1)
    select upd.before, r.pickup, r.dropoff from upd, cab_rides r where r.id = ${rideId}`));
  if (changed) {
    await writeCabAudit(actor, "cost_edited", { rideId, subject: `${changed.pickup} → ${changed.dropoff}`, details: { from: formatRupees(Number(changed.before)), to: formatRupees(fare) } });
    return "changed";
  }
  const [state] = rows<{ status: string | null; invoiced: string | null }>(await db.execute(sql`
    select (select status::text from cab_rides where id = ${rideId}) as status,
      (select i.status from cab_ride_costs c join cab_invoices i on i.id = c.invoice_id where c.ride_id = ${rideId}) as invoiced`));
  if (!state.status) throw new CabsError("That ride no longer exists. Reload and try again.", 404);
  if (state.status !== "completed") throw new CabsError("Only a completed ride gets a cost.", 409);
  throw new CabsError(`This ride's invoice has been ${state.invoiced}, so its cost can't change now.`, 409);
}

/** The branches rides were booked from, for the filters and the invoice form. */
export async function rideBranches(): Promise<string[]> {
  return rows<{ b: string }>(await db.execute(sql`select distinct requested_by_branch as b from cab_rides where requested_by_branch is not null order by 1`)).map((x) => x.b);
}
