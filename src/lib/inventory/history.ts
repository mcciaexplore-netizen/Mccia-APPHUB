import "server-only";
import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { inventoryItems as items, inventoryPurchaseOrders as pos, inventoryRequests as reqs, inventoryStockMovements as m, inventoryVendors as vendors } from "@/db/inventory-schema";

/**
 * Read-only stock history for Inventory admins: every movement (Stock movements) and the inward ones only (Purchases). Filters arrive as
 * text from the address and are checked here; dates are whole days in India time ("from" and "to" both included).
 */

export const MOVEMENT_KINDS = ["inward", "issue", "return", "adjust", "recount"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];
export const PAGE_SIZE = 100;

const isDay = (d: string | undefined): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00+05:30`));
/** The start of a day in India time, and the start of the day after (for an inclusive "to"). */
const dayStart = (d: string) => new Date(`${d}T00:00:00+05:30`);
const dayAfter = (d: string) => new Date(dayStart(d).getTime() + 86_400_000);

function dateRange(from?: string, to?: string): SQL[] {
  const w: SQL[] = [];
  if (isDay(from)) w.push(gte(m.createdAt, dayStart(from)));
  if (isDay(to)) w.push(lt(m.createdAt, dayAfter(to)));
  return w;
}

export type MovementRow = {
  id: string; createdAt: Date; item: string; unit: string; kind: MovementKind; delta: number; quantityAfter: number; actorName: string; reason: string | null;
  issuedToName: string | null; eventName: string | null; vendor: string | null; poId: string | null; poNo: string | null; requestId: string | null; requestedByName: string | null; challanNo: string | null;
};

export async function listMovements(f: { itemId?: string; kind?: string; from?: string; to?: string; page?: number }): Promise<{ rows: MovementRow[]; total: number; page: number }> {
  const where: SQL[] = [...dateRange(f.from, f.to)];
  if (f.itemId && /^[0-9a-f-]{36}$/i.test(f.itemId)) where.push(eq(m.itemId, f.itemId));
  if (f.kind && (MOVEMENT_KINDS as readonly string[]).includes(f.kind)) where.push(eq(m.kind, f.kind as MovementKind));
  const cond = where.length ? and(...where) : undefined;
  const page = Math.max(1, Math.floor(f.page ?? 1));
  const [rows, [{ total }]] = await Promise.all([
    db.select({
      id: m.id, createdAt: m.createdAt, item: items.name, unit: items.unit, kind: m.kind, delta: m.delta, quantityAfter: m.quantityAfter, actorName: m.actorName, reason: m.reason,
      issuedToName: m.issuedToName, eventName: m.eventName, vendor: vendors.name, poId: m.purchaseOrderId, poNo: pos.poNo, requestId: m.requestId, requestedByName: reqs.requestedByName, challanNo: m.challanNo,
    })
      .from(m).innerJoin(items, eq(items.id, m.itemId)).leftJoin(vendors, eq(vendors.id, m.vendorId)).leftJoin(pos, eq(pos.id, m.purchaseOrderId)).leftJoin(reqs, eq(reqs.id, m.requestId))
      .where(cond).orderBy(desc(m.createdAt), desc(m.id)).limit(PAGE_SIZE).offset((page - 1) * PAGE_SIZE),
    db.select({ total: sql<number>`count(*)`.mapWith(Number) }).from(m).where(cond),
  ]);
  return { rows: rows as MovementRow[], total, page };
}

export type InwardRow = { id: string; createdAt: Date; item: string; unit: string; quantity: number; ratePaise: number | null; vendor: string | null; poId: string | null; poNo: string | null; challanNo: string | null; actorName: string };

/** Inward goods (purchases): newest first, with the total value of what is shown. */
export async function listInward(f: { vendorId?: string; from?: string; to?: string }): Promise<{ rows: InwardRow[]; totalPaise: number; capped: boolean }> {
  const where: SQL[] = [eq(m.kind, "inward"), ...dateRange(f.from, f.to)];
  if (f.vendorId && /^[0-9a-f-]{36}$/i.test(f.vendorId)) where.push(eq(m.vendorId, f.vendorId));
  const rows = await db.select({
    id: m.id, createdAt: m.createdAt, item: items.name, unit: items.unit, quantity: m.delta, ratePaise: m.ratePaise, vendor: sql<string | null>`coalesce(${vendors.name}, ${pos.vendorName})`,
    poId: m.purchaseOrderId, poNo: pos.poNo, challanNo: m.challanNo, actorName: m.actorName,
  })
    .from(m).innerJoin(items, eq(items.id, m.itemId)).leftJoin(vendors, eq(vendors.id, m.vendorId)).leftJoin(pos, eq(pos.id, m.purchaseOrderId))
    .where(and(...where)).orderBy(desc(m.createdAt)).limit(2001);
  const shown = rows.slice(0, 2000);
  return { rows: shown, totalPaise: shown.reduce((t, r) => t + r.quantity * (r.ratePaise ?? 0), 0), capped: rows.length > 2000 };
}
