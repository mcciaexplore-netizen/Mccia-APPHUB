import "server-only";
import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { cabAuditLog } from "@/db/cabs-schema";
import { writeAudit } from "@/lib/audit";
import { logError } from "@/lib/log-error";
import { scrub } from "@/lib/scrub";
import type { CabUser } from "./host-adapter";

/**
 * The Cab Booking audit log (cab_audit_log), shown to Cabs admins at Cabs Admin → Audit Log: who did what, to which ride, driver or
 * vehicle. `details.subject` names what it was about ("Pune HQ → Airport", "MH 12 AB 1234", a driver's name) so an entry reads on its own.
 */

export const AUDIT_ACTIONS = {
  ride_created: "Ride booked",
  ride_assigned: "Ride assigned",
  ride_started: "Ride started",
  ride_completed: "Ride completed",
  ride_cancelled: "Ride cancelled",
  otp_verified: "OTP verified",
  otp_failed: "Wrong OTP entered",
  otp_reset: "New OTP made",
  maintenance_added: "Maintenance recorded",
  maintenance_edited: "Maintenance edited",
  maintenance_deleted: "Maintenance deleted",
  fuel_recorded: "Fuel cost recorded",
  fuel_deleted: "Fuel cost deleted",
  cost_recorded: "Ride cost recorded",
  cost_edited: "Ride cost changed",
  invoice_created: "Invoice created",
  invoice_sent: "Invoice marked sent",
  invoice_paid: "Invoice marked paid",
  invoice_deleted: "Draft invoice deleted",
  driver_added: "Driver added",
  driver_edited: "Driver edited",
  driver_updated: "Driver's vehicle changed",
  driver_availability: "Driver availability changed",
  driver_removed: "Driver removed",
  driver_login_otp: "Driver sign-in OTP made",
  driver_signed_in: "Driver signed in by phone",
  driver_access_requested: "Driver asked for a login OTP",
  vehicle_added: "Vehicle added",
  vehicle_updated: "Vehicle edited",
  vehicle_deactivated: "Vehicle deactivated",
} as const;
export type CabAuditAction = keyof typeof AUDIT_ACTIONS;
export const isAuditAction = (v: string): v is CabAuditAction => Object.hasOwn(AUDIT_ACTIONS, v);

type Actor = Pick<CabUser, "id" | "name"> & Partial<Pick<CabUser, "via">>;

/**
 * Records one action, after it has happened: a failure to record it is logged, not reported, because the change the person made is saved
 * and must not look as if it failed. Changes to drivers and vehicles also go to the hub's audit log (cabs.*), as Inventory's do.
 */
export async function writeCabAudit(actor: Actor, action: CabAuditAction, entry: { rideId?: string | null; subject: string; details?: Record<string, unknown> }): Promise<void> {
  const details = scrub({ subject: entry.subject.slice(0, 200), ...entry.details }) as Record<string, unknown>;
  try {
    await db.insert(cabAuditLog).values({ action, actorId: actor.id, actorName: actor.name, rideId: entry.rideId ?? null, details });
  } catch (e) {
    logError(`[cabs] audit entry not saved: ${action}`, e);
  }
  // A driver signed in by phone has no hub account, so their own actions (going online, signing in) stay in the module's log only.
  if ((action.startsWith("driver_") || action.startsWith("vehicle_")) && actor.via !== "phone") {
    try {
      await writeAudit(actor, [{ action: `cabs.${action}`, targetType: "system", targetLabel: entry.subject.slice(0, 200), details: entry.details ?? {} }]);
    } catch (e) {
      logError(`[cabs] hub audit entry not saved: ${action}`, e);
    }
  }
}

/* ---------------------------------------------------------------- reading */

export const AUDIT_PAGE_SIZE = 50;
/** `actor`: the id of who did it; `ride`: a ride's id (the whole id, or its first 8 characters as the page shows it). */
export type AuditFilters = { action?: string; from?: string; to?: string; actor?: string; ride?: string };
export type AuditRow = { id: string; createdAt: Date; actorName: string; action: string; rideId: string | null; details: Record<string, unknown> | null };

const isDay = (d: string | undefined): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00+05:30`));
/** Whole days in India time, "from" and "to" both included. */
const dayStart = (d: string) => new Date(`${d}T00:00:00+05:30`);

function where(f: AuditFilters): SQL | undefined {
  const c: SQL[] = [];
  if (f.action && isAuditAction(f.action)) c.push(eq(cabAuditLog.action, f.action));
  if (isDay(f.from)) c.push(gte(cabAuditLog.createdAt, dayStart(f.from)));
  if (isDay(f.to)) c.push(lt(cabAuditLog.createdAt, new Date(dayStart(f.to).getTime() + 86_400_000)));
  if (f.actor && /^[0-9a-f-]{36}$/i.test(f.actor)) c.push(eq(cabAuditLog.actorId, f.actor));
  const ride = f.ride?.trim().toLowerCase();
  if (ride && /^[0-9a-f-]{36}$/.test(ride)) c.push(eq(cabAuditLog.rideId, ride));
  else if (ride && /^[0-9a-f]{8}$/.test(ride)) c.push(sql`${cabAuditLog.rideId}::text like ${`${ride}%`}`);
  else if (ride) c.push(sql`false`);
  return c.length ? and(...c) : undefined;
}

const columns = { id: cabAuditLog.id, createdAt: cabAuditLog.createdAt, actorName: cabAuditLog.actorName, action: cabAuditLog.action, rideId: cabAuditLog.rideId, details: cabAuditLog.details };

/** One page of entries, newest first, and how many there are in all. */
export async function listCabAudit(f: AuditFilters, page: number): Promise<{ rows: AuditRow[]; total: number; page: number }> {
  const w = where(f);
  const p = Math.max(1, Math.floor(page) || 1);
  const [rows, [{ total }]] = await Promise.all([
    db.select(columns).from(cabAuditLog).where(w).orderBy(desc(cabAuditLog.createdAt), desc(cabAuditLog.id)).limit(AUDIT_PAGE_SIZE).offset((p - 1) * AUDIT_PAGE_SIZE),
    db.select({ total: sql<number>`count(*)`.mapWith(Number) }).from(cabAuditLog).where(w),
  ]);
  return { rows, total, page: p };
}

/** Every entry the filters match, newest first, for the CSV export (at most 20,000). */
export async function exportCabAudit(f: AuditFilters): Promise<AuditRow[]> {
  return db.select(columns).from(cabAuditLog).where(where(f)).orderBy(desc(cabAuditLog.createdAt), desc(cabAuditLog.id)).limit(20_000);
}

/** Everyone who appears in the log, by name, for the "Who" filter (an id can have had more than one name: the latest is shown). */
export async function auditActors(): Promise<{ id: string; name: string }[]> {
  return (await db.execute(sql`
    select distinct on (actor_id) actor_id as id, actor_name as name from cab_audit_log order by actor_id, created_at desc`) as unknown as { rows: { id: string; name: string }[] })
    .rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** What an entry was about. */
export const subjectOf = (details: Record<string, unknown> | null) => String(details?.subject ?? "");

/** The rest of an entry's details as one line of text: "Driver: Ravi · Vehicle: MH 12 AB 1234". */
export function detailsText(details: Record<string, unknown> | null): string {
  if (!details) return "";
  const label = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
  const value = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return Object.entries(details).filter(([k]) => k !== "subject").map(([k, v]) => `${label(k)}: ${value(v)}`).join(" · ");
}
