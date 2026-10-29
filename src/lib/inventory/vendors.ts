import "server-only";
import { and, asc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { inventoryVendors } from "@/db/inventory-schema";
import { writeAudit } from "@/lib/audit";
import { InventoryError } from "./errors";
import type { InventoryUser } from "./host-adapter";
import type { VendorInput } from "./validation";

/**
 * The vendor directory: mainly a reference list for purchase orders and inward goods. Any vendor can be deleted: purchase orders keep the
 * vendor's name (they store it themselves) and they, stock movements and items just lose the link. Deactivating hides a vendor from new
 * choices instead. Every change is recorded in the hub's audit log as inventory.vendor_*.
 */

type Actor = Pick<InventoryUser, "id" | "name">;
const audit = (actor: Actor, action: string, id: string, label: string, details: Record<string, unknown> = {}) =>
  writeAudit(actor, [{ action: `inventory.${action}`, targetType: "system", targetId: id, targetLabel: label, details }]);

export type VendorRow = {
  id: string; name: string; email: string | null; phone: string | null; address: string | null; gstin: string | null; pan: string | null; active: boolean; inUse: boolean;
};

// The vendor's id is written out in full: inside a single-table select Drizzle renders a column as a bare "id", which the subqueries
// below would read as their own id.
const inUse = sql<boolean>`(exists (select 1 from inventory_purchase_orders po where po.vendor_id = inventory_vendors.id)
  or exists (select 1 from inventory_stock_movements m where m.vendor_id = inventory_vendors.id))`;

export async function listVendors(f: { q?: string; includeInactive?: boolean }): Promise<VendorRow[]> {
  const where: SQL[] = [];
  if (!f.includeInactive) where.push(eq(inventoryVendors.active, true));
  const q = f.q?.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  if (q) where.push(or(ilike(inventoryVendors.name, `%${q}%`), ilike(inventoryVendors.email, `%${q}%`), ilike(inventoryVendors.gstin, `%${q}%`), ilike(inventoryVendors.phone, `%${q}%`))!);
  return db
    .select({
      id: inventoryVendors.id, name: inventoryVendors.name, email: inventoryVendors.email, phone: inventoryVendors.phone, address: inventoryVendors.address,
      gstin: inventoryVendors.gstin, pan: inventoryVendors.pan, active: inventoryVendors.active, inUse,
    })
    .from(inventoryVendors)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(sql`lower(${inventoryVendors.name})`))
    .limit(2000);
}

export async function createVendor(v: VendorInput, actor: Actor) {
  const [row] = await db.insert(inventoryVendors).values(v).returning({ id: inventoryVendors.id, name: inventoryVendors.name });
  await audit(actor, "vendor_create", row.id, row.name);
  return row;
}

const FIELDS = ["name", "email", "phone", "address", "gstin", "pan"] as const;

/** Saves a vendor. Turning Active off or on is recorded as vendor_deactivate / vendor_activate; other changes as vendor_update. */
export async function updateVendor(id: string, v: VendorInput, actor: Actor) {
  const [before] = await db.select().from(inventoryVendors).where(eq(inventoryVendors.id, id));
  if (!before) throw new InventoryError("That vendor no longer exists. Reload and try again.", 404);
  await db.update(inventoryVendors).set(v).where(eq(inventoryVendors.id, id));
  const changed = FIELDS.filter((k) => (before[k] ?? null) !== (v[k] ?? null));
  if (changed.length) await audit(actor, "vendor_update", id, v.name, { changed });
  if (before.active !== v.active) await audit(actor, v.active ? "vendor_activate" : "vendor_deactivate", id, v.name);
}

/**
 * Deletes a vendor. Purchase orders keep the vendor's name (and email) as they were written; their link to the directory, and that of stock
 * movements and items, is cleared by the database (on delete set null). Counted in the audit entry.
 */
export async function deleteVendor(id: string, actor: Actor) {
  const res = (await db.execute(sql`
    with refs as (
      select (select count(*) from inventory_purchase_orders where vendor_id = ${id})::int as pos, (select count(*) from inventory_stock_movements where vendor_id = ${id})::int as movements
    ), gone as (
      delete from inventory_vendors where id = ${id} returning name
    )
    select (select name from gone) as name, refs.pos, refs.movements from refs`)) as unknown as { rows: { name: string | null; pos: number; movements: number }[] };
  const row = res.rows[0];
  if (!row?.name) throw new InventoryError("That vendor no longer exists. Reload and try again.", 404);
  await audit(actor, "vendor_delete", id, row.name, { purchaseOrdersKeepingTheName: row.pos, stockMovementsUnlinked: row.movements });
}
