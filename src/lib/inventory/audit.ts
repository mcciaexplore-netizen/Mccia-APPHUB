import "server-only";
import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { branches } from "@/db/schema";
import { invAuditLog } from "@/db/inventory-schema";
import { logError } from "@/lib/log-error";
import { scrub } from "@/lib/scrub";
import type { InventoryUser } from "./host-adapter";

/**
 * The Inventory audit log (inv_audit_log), shown to Inventory admins at Inventory → Audit Log. Every entry names who, what, which item,
 * request or ticket, and the branch it happened at. The hub's own audit log keeps its inventory.* entries as well; this one is the
 * module's, with branches.
 */

export const AUDIT_ACTIONS = {
  item_added: "Item added",
  item_edited: "Item edited",
  item_deleted: "Item deleted",
  stock_adjusted: "Stock adjusted",
  stock_transferred: "Stock transferred",
  request_created: "Request created",
  request_fulfilled: "Request fulfilled",
  request_rejected: "Request rejected",
  ticket_created: "Maintenance ticket created",
  ticket_resolved: "Maintenance ticket resolved",
} as const;
export type InventoryAuditAction = keyof typeof AUDIT_ACTIONS;
export const isAuditAction = (v: string): v is InventoryAuditAction => Object.hasOwn(AUDIT_ACTIONS, v);

export type InventoryAuditEntry = {
  targetType: "item" | "request" | "ticket";
  targetId?: string | null;
  targetLabel: string;
  branchId?: string | null;
  details?: Record<string, unknown>;
};

/**
 * Records one Inventory action. It is written after the action itself has happened, so a failure to record it is logged rather than
 * reported to the person: the change they made is already saved and must not look as if it failed.
 */
export async function writeInventoryAudit(actor: Pick<InventoryUser, "id" | "name">, action: InventoryAuditAction, entry: InventoryAuditEntry): Promise<void> {
  try {
    await db.insert(invAuditLog).values({
      action, actorId: actor.id, actorName: actor.name, targetType: entry.targetType, targetId: entry.targetId ?? null,
      targetLabel: entry.targetLabel.slice(0, 200), details: scrub(entry.details ?? {}) as Record<string, unknown>, branchId: entry.branchId ?? null,
    });
  } catch (e) {
    logError(`[inventory] audit entry not saved: ${action}`, e);
  }
}

/* ---------------------------------------------------------------- reading */

export const AUDIT_PAGE_SIZE = 50;
export type AuditFilters = { branchId?: string; action?: string; from?: string; to?: string };
export type AuditRow = {
  id: string; createdAt: Date; actorName: string; action: string; targetType: string; targetLabel: string; branchName: string | null; details: Record<string, unknown> | null;
};

const isId = (v: string | undefined): v is string => !!v && /^[0-9a-f-]{36}$/i.test(v);
const isDay = (d: string | undefined): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00+05:30`));
/** Whole days in India time, "from" and "to" both included. */
const dayStart = (d: string) => new Date(`${d}T00:00:00+05:30`);

function where(f: AuditFilters): SQL | undefined {
  const c: SQL[] = [];
  if (isId(f.branchId)) c.push(eq(invAuditLog.branchId, f.branchId));
  if (f.action && isAuditAction(f.action)) c.push(eq(invAuditLog.action, f.action));
  if (isDay(f.from)) c.push(gte(invAuditLog.createdAt, dayStart(f.from)));
  if (isDay(f.to)) c.push(lt(invAuditLog.createdAt, new Date(dayStart(f.to).getTime() + 86_400_000)));
  return c.length ? and(...c) : undefined;
}

const columns = {
  id: invAuditLog.id, createdAt: invAuditLog.createdAt, actorName: invAuditLog.actorName, action: invAuditLog.action, targetType: invAuditLog.targetType,
  targetLabel: invAuditLog.targetLabel, branchName: branches.name, details: invAuditLog.details,
};

/** One page of entries, newest first, and how many there are in all. */
export async function listInventoryAudit(f: AuditFilters, page: number): Promise<{ rows: AuditRow[]; total: number; page: number }> {
  const w = where(f);
  const p = Math.max(1, Math.floor(page) || 1);
  const [rows, [{ total }]] = await Promise.all([
    db.select(columns).from(invAuditLog).leftJoin(branches, eq(branches.id, invAuditLog.branchId)).where(w)
      .orderBy(desc(invAuditLog.createdAt), desc(invAuditLog.id)).limit(AUDIT_PAGE_SIZE).offset((p - 1) * AUDIT_PAGE_SIZE),
    db.select({ total: sql<number>`count(*)`.mapWith(Number) }).from(invAuditLog).where(w),
  ]);
  return { rows, total, page: p };
}

/** Every entry the filters match, newest first, for the CSV export (at most 20,000). */
export async function exportInventoryAudit(f: AuditFilters): Promise<AuditRow[]> {
  return db.select(columns).from(invAuditLog).leftJoin(branches, eq(branches.id, invAuditLog.branchId)).where(where(f))
    .orderBy(desc(invAuditLog.createdAt), desc(invAuditLog.id)).limit(20_000);
}

/** The details of an entry as one line of text: "From: Pune · To: Bhosari · Quantity: 4". */
export function detailsText(details: Record<string, unknown> | null): string {
  if (!details) return "";
  const label = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
  const value = (v: unknown): string =>
    v === null || v === undefined || v === "" ? "—"
      : typeof v === "object" ? (Array.isArray(v) ? v.map(value).join(", ") : Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k} ${value(x)}`).join(", "))
        : String(v);
  return Object.entries(details).map(([k, v]) => `${label(k)}: ${value(v)}`).join(" · ");
}
