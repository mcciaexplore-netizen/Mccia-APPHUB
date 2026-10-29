import "server-only";
import { and, asc, desc, eq, ilike, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { inventoryCategories, inventoryItems, inventoryStockMovements } from "@/db/inventory-schema";
import { writeAudit } from "@/lib/audit";
import { InventoryError } from "./errors";
import type { InventoryUser } from "./host-adapter";
import type { ItemInput } from "./validation";

/**
 * The item catalogue and its categories. The production driver has no transactions, so every change that touches an item's quantity is ONE
 * statement that also writes the matching row in inventory_stock_movements: the quantity can always be explained by its history.
 * Admin changes are recorded in the hub's audit log (Administrator → Activity Log) as inventory.* actions.
 */

type Actor = Pick<InventoryUser, "id" | "name">;
const audit = (actor: Actor, action: string, targetId: string | null, targetLabel: string, details: Record<string, unknown> = {}) =>
  writeAudit(actor, [{ action: `inventory.${action}`, targetType: "system", targetId, targetLabel, details }]);

/* ---------------------------------------------------------------- categories */

export type CategoryRow = { id: string; name: string; items: number };

export async function listCategories(): Promise<CategoryRow[]> {
  return db
    .select({ id: inventoryCategories.id, name: inventoryCategories.name, items: sql<number>`count(${inventoryItems.id})`.mapWith(Number) })
    .from(inventoryCategories)
    .leftJoin(inventoryItems, eq(inventoryItems.categoryId, inventoryCategories.id))
    .groupBy(inventoryCategories.id)
    .orderBy(asc(sql`lower(${inventoryCategories.name})`));
}

export async function createCategory(name: string, actor: Actor) {
  const [row] = await db.insert(inventoryCategories).values({ name }).returning({ id: inventoryCategories.id, name: inventoryCategories.name });
  await audit(actor, "category_create", row.id, row.name);
  return row;
}

export async function renameCategory(id: string, name: string, actor: Actor) {
  const [before] = await db.select({ name: inventoryCategories.name }).from(inventoryCategories).where(eq(inventoryCategories.id, id));
  if (!before) throw new InventoryError("That category no longer exists. Reload and try again.", 404);
  if (before.name === name) return;
  await db.update(inventoryCategories).set({ name }).where(eq(inventoryCategories.id, id));
  await audit(actor, "category_rename", id, name, { from: before.name, to: name });
}

/** Its items stay, without a category (the foreign key sets theirs to empty). */
export async function deleteCategory(id: string, actor: Actor): Promise<{ items: number }> {
  const res = (await db.execute(sql`
    with gone as (delete from inventory_categories where id = ${id} returning name)
    select gone.name, (select count(*) from inventory_items where category_id = ${id})::int as items from gone`)) as unknown as { rows: { name: string; items: number }[] };
  const row = res.rows[0];
  if (!row) throw new InventoryError("That category no longer exists. Reload and try again.", 404);
  await audit(actor, "category_delete", id, row.name, { itemsLeftWithoutCategory: row.items });
  return { items: row.items };
}

/* ---------------------------------------------------------------- items */

export type ItemRow = {
  id: string; name: string; categoryId: string | null; category: string | null; unit: string; quantity: number; minQuantity: number;
  ratePaise: number | null; location: string | null; notes: string | null; active: boolean; low: boolean;
};

export type ItemFilters = { q?: string; categoryId?: string; low?: boolean; includeInactive?: boolean };

const isLow = sql<boolean>`${inventoryItems.quantity} < ${inventoryItems.minQuantity}`;

export async function listItems(f: ItemFilters): Promise<ItemRow[]> {
  const where: SQL[] = [];
  if (!f.includeInactive) where.push(eq(inventoryItems.active, true));
  if (f.q?.trim()) where.push(ilike(inventoryItems.name, `%${f.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`));
  if (f.categoryId) where.push(eq(inventoryItems.categoryId, f.categoryId));
  if (f.low) where.push(lt(inventoryItems.quantity, inventoryItems.minQuantity));
  return db
    .select({
      id: inventoryItems.id, name: inventoryItems.name, categoryId: inventoryItems.categoryId, category: inventoryCategories.name, unit: inventoryItems.unit,
      quantity: inventoryItems.quantity, minQuantity: inventoryItems.minQuantity, ratePaise: inventoryItems.ratePaise, location: inventoryItems.location,
      notes: inventoryItems.notes, active: inventoryItems.active, low: isLow,
    })
    .from(inventoryItems)
    .leftJoin(inventoryCategories, eq(inventoryCategories.id, inventoryItems.categoryId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(isLow), asc(sql`lower(${inventoryItems.name})`))
    .limit(2000);
}

/** A new item. Any starting quantity is written to the ledger as "Opening stock" in the same statement. */
export async function createItem(v: ItemInput, actor: Actor) {
  const res = (await db.execute(sql`
    with item as (
      insert into inventory_items (name, category_id, unit, quantity, min_quantity, rate_paise, location, notes, active)
      values (${v.name}, ${v.categoryId}, ${v.unit}, ${v.quantity}, ${v.minQuantity}, ${v.rate}, ${v.location}, ${v.notes}, ${v.active})
      returning id, name, quantity
    ), opening as (
      insert into inventory_stock_movements (item_id, kind, delta, quantity_after, reason, actor_user_id, actor_name)
      select id, 'adjust', quantity, quantity, 'Opening stock', ${actor.id}, ${actor.name} from item where quantity > 0
    )
    select id, name from item`)) as unknown as { rows: { id: string; name: string }[] };
  const row = res.rows[0];
  await audit(actor, "item_create", row.id, row.name, { quantity: v.quantity, unit: v.unit });
  return row;
}

/**
 * Saves an item. A changed quantity is a recount: the difference goes to the ledger in the same statement, against the quantity as it
 * was at that moment (so a change made by someone else in between is not lost from the history).
 */
export async function updateItem(id: string, v: ItemInput, actor: Actor) {
  // The old quantity comes from the locked row inside the UPDATE itself (UPDATE … FROM (SELECT … FOR UPDATE)): a separate locking CTE
  // would see the row as already changed by this same statement and return nothing, and a plain read could be stale if someone saved first.
  const res = (await db.execute(sql`
    with item as (
      update inventory_items i set name = ${v.name}, category_id = ${v.categoryId}, unit = ${v.unit}, quantity = ${v.quantity},
        min_quantity = ${v.minQuantity}, rate_paise = ${v.rate}, location = ${v.location}, notes = ${v.notes}, active = ${v.active}
      from (select id, quantity from inventory_items where id = ${id} for update) old
      where i.id = old.id
      returning i.name, old.quantity as before
    ), recount as (
      insert into inventory_stock_movements (item_id, kind, delta, quantity_after, reason, actor_user_id, actor_name)
      select ${id}, 'recount', ${v.quantity} - item.before, ${v.quantity}, 'Changed on the item', ${actor.id}, ${actor.name}
      from item where item.before <> ${v.quantity}
    )
    select name, before from item`)) as unknown as { rows: { name: string; before: number }[] };
  const row = res.rows[0];
  if (!row) throw new InventoryError("That item no longer exists. Reload and try again.", 404);
  await audit(actor, "item_update", id, row.name, row.before !== v.quantity ? { quantity: { from: row.before, to: v.quantity } } : {});
}

/**
 * Removes an item that has no history. One with stock movements or requests cannot be deleted (its history would be lost): it can be
 * made inactive instead, which hides it everywhere but keeps its records.
 */
export async function deleteItem(id: string, actor: Actor) {
  const res = (await db.execute(sql`
    with used as (
      select exists (select 1 from inventory_stock_movements where item_id = ${id}) or exists (select 1 from inventory_requests where item_id = ${id}) as used
    ), gone as (
      delete from inventory_items where id = ${id} and not (select used from used) returning name
    )
    select (select name from gone) as name, (select used from used) as used, exists (select 1 from inventory_items where id = ${id}) as existed`)) as unknown as { rows: { name: string | null; used: boolean; existed: boolean }[] };
  const row = res.rows[0];
  if (!row?.existed) throw new InventoryError("That item no longer exists. Reload and try again.", 404);
  if (row.used || !row.name) throw new InventoryError("This item has stock history, so it can't be deleted. Edit it and untick Active to hide it instead.", 409);
  await audit(actor, "item_delete", id, row.name);
}

/* ---------------------------------------------------------------- dashboard */

export type DashboardStats = { items: number; units: number; valuePaise: number; lowStock: number; pendingRequests: number; openTickets: number };

/** The dashboard's numbers, from the active items only, in one round trip. */
export async function dashboardStats(): Promise<DashboardStats> {
  const res = (await db.execute(sql`
    select
      (select count(*) from inventory_items where active)::int as items,
      (select coalesce(sum(quantity), 0) from inventory_items where active)::bigint as units,
      (select coalesce(sum(quantity::bigint * coalesce(rate_paise, 0)), 0) from inventory_items where active)::bigint as value_paise,
      (select count(*) from inventory_items where active and quantity < min_quantity)::int as low_stock,
      (select count(*) from inventory_requests where status = 'pending')::int as pending_requests,
      (select count(*) from inventory_maintenance_tickets where status <> 'resolved')::int as open_tickets`)) as unknown as {
    rows: { items: number; units: string | number; value_paise: string | number; low_stock: number; pending_requests: number; open_tickets: number }[];
  };
  const r = res.rows[0];
  return { items: Number(r.items), units: Number(r.units), valuePaise: Number(r.value_paise), lowStock: Number(r.low_stock), pendingRequests: Number(r.pending_requests), openTickets: Number(r.open_tickets) };
}

export async function lowStockItems(limit = 8) {
  return db
    .select({ id: inventoryItems.id, name: inventoryItems.name, unit: inventoryItems.unit, quantity: inventoryItems.quantity, minQuantity: inventoryItems.minQuantity })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.active, true), lt(inventoryItems.quantity, inventoryItems.minQuantity)))
    .orderBy(sql`${inventoryItems.quantity}::float / greatest(${inventoryItems.minQuantity}, 1)`, asc(inventoryItems.name))
    .limit(limit);
}

export async function recentMovements(limit = 8) {
  return db
    .select({
      id: inventoryStockMovements.id, kind: inventoryStockMovements.kind, delta: inventoryStockMovements.delta, item: inventoryItems.name,
      reason: inventoryStockMovements.reason, issuedToName: inventoryStockMovements.issuedToName, eventName: inventoryStockMovements.eventName,
      actorName: inventoryStockMovements.actorName, createdAt: inventoryStockMovements.createdAt,
    })
    .from(inventoryStockMovements)
    .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryStockMovements.itemId))
    .orderBy(desc(inventoryStockMovements.createdAt))
    .limit(limit);
}
