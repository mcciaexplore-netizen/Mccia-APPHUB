import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";

/**
 * Booking and driving activity. Self-contained: user activity reads cab_rides only, driver activity cab_rides and cab_drivers only.
 * "This month" and "this week" (Monday to Sunday) are India time.
 */

const rows = <T,>(res: unknown) => (res as { rows: T[] }).rows;
const isDay = (d: string | undefined): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
const IST = sql`'Asia/Kolkata'`;
const monthOf = (col: SQL) => sql`date_trunc('month', ${col} at time zone ${IST}) = date_trunc('month', now() at time zone ${IST})`;
const weekOf = (col: SQL) => sql`date_trunc('week', ${col} at time zone ${IST}) = date_trunc('week', now() at time zone ${IST})`;

export type UserActivity = {
  userId: string; name: string; branch: string | null; total: number; month: number; week: number; lastRide: Date | null; commonPickup: string | null;
};
export type UserActivityFilter = { branch?: string; from?: string; to?: string; sort?: "total" | "name" };

/**
 * Per person who booked: their latest name and branch, rides in the filters' range (by scheduled day), this month and this week, their last
 * ride, and the pickup they use most (ignoring case and spaces; shown as they last typed it).
 */
export async function userActivity(f: UserActivityFilter = {}): Promise<UserActivity[]> {
  const c: SQL[] = [sql`true`];
  if (f.branch) c.push(sql`r.requested_by_branch = ${f.branch}`);
  if (isDay(f.from)) c.push(sql`(r.scheduled_for at time zone ${IST})::date >= ${f.from}::date`);
  if (isDay(f.to)) c.push(sql`(r.scheduled_for at time zone ${IST})::date <= ${f.to}::date`);
  const order = f.sort === "name" ? sql`name asc` : sql`total desc, name asc`;
  return rows<Record<string, unknown>>(await db.execute(sql`
    with picked as (select * from cab_rides r where ${sql.join(c, sql` and `)}),
    per as (
      select requested_by_id, (array_agg(requested_by_name order by created_at desc))[1] as name, (array_agg(requested_by_branch order by created_at desc))[1] as branch,
        count(*)::int as total, count(*) filter (where ${monthOf(sql`scheduled_for`)})::int as month, count(*) filter (where ${weekOf(sql`scheduled_for`)})::int as week,
        max(scheduled_for) as last_ride
      from picked group by requested_by_id),
    pickups as (
      select distinct on (requested_by_id) requested_by_id, (array_agg(trim(pickup) order by created_at desc))[1] as pickup
      from picked group by requested_by_id, lower(regexp_replace(trim(pickup), '\\s+', ' ', 'g'))
      order by requested_by_id, count(*) desc, max(created_at) desc)
    select per.*, pickups.pickup as common_pickup from per left join pickups using (requested_by_id) order by ${order}`)).map((x) => ({
    userId: String(x.requested_by_id), name: String(x.name), branch: (x.branch as string) ?? null, total: Number(x.total), month: Number(x.month), week: Number(x.week),
    lastRide: x.last_ride ? new Date(x.last_ride as string) : null, commonPickup: (x.common_pickup as string) ?? null,
  }));
}

export type DriverActivity = {
  driverId: string; name: string; phone: string; vehiclePlate: string | null; completed: number; month: number; week: number; avgMinutes: number | null;
  isAvailable: boolean; lastActive: Date | null;
};
export type DriverActivityFilter = { from?: string; to?: string; available?: "yes" | "no" };

/**
 * Per driver: rides completed in the range (by completion day), this month and this week, the average time from start to completion,
 * availability, and when they last started or completed a ride. The vehicle is the plate of their latest ride.
 */
export async function driverActivity(f: DriverActivityFilter = {}): Promise<DriverActivity[]> {
  const c: SQL[] = [sql`r.status = 'completed'`];
  if (isDay(f.from)) c.push(sql`(r.completed_at at time zone ${IST})::date >= ${f.from}::date`);
  if (isDay(f.to)) c.push(sql`(r.completed_at at time zone ${IST})::date <= ${f.to}::date`);
  const avail = f.available === "yes" ? sql`d.is_available` : f.available === "no" ? sql`not d.is_available` : sql`true`;
  return rows<Record<string, unknown>>(await db.execute(sql`
    select d.id, d.name, d.phone, d.is_available,
      (select vehicle_plate from cab_rides x where x.driver_id = d.id and x.vehicle_plate is not null order by x.assigned_at desc nulls last limit 1) as vehicle_plate,
      count(r.id)::int as completed, count(r.id) filter (where ${monthOf(sql`r.completed_at`)})::int as month, count(r.id) filter (where ${weekOf(sql`r.completed_at`)})::int as week,
      round(avg(extract(epoch from (r.completed_at - r.started_at)) / 60) filter (where r.started_at is not null))::int as avg_minutes,
      (select max(greatest(x.started_at, x.completed_at)) from cab_rides x where x.driver_id = d.id) as last_active
    from cab_drivers d left join cab_rides r on r.driver_id = d.id and ${sql.join(c, sql` and `)}
    where ${avail}
    group by d.id order by completed desc, d.name`)).map((x) => ({
    driverId: String(x.id), name: String(x.name), phone: String(x.phone), vehiclePlate: (x.vehicle_plate as string) ?? null, completed: Number(x.completed), month: Number(x.month),
    week: Number(x.week), avgMinutes: x.avg_minutes == null ? null : Number(x.avg_minutes), isAvailable: !!x.is_available, lastActive: x.last_active ? new Date(x.last_active as string) : null,
  }));
}
