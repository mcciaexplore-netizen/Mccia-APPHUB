import "server-only";
import { and, asc, desc, eq, ilike, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { branches } from "@/db/schema";
import { inventoryBranchStock as stock, inventoryCategories, inventoryItems, inventoryStockMovements } from "@/db/inventory-schema";
import { writeAudit } from "@/lib/audit";
import { InventoryError } from "./errors";
import type { InventoryUser } from "./host-adapter";
import type { ItemInput } from "./validation";

/**
 * The item catalogue and its categories. The production driver has no transactions, so every change that touches an item's quantity is ONE
 * statement that also writes the matching row in inventory_stock_movements: the quantity can always be explained by its history.
 * Admin changes are recorded in the hub's audit log (Administrator → Activity Log) as inventory.* actions.
 *
 * Stock is per branch: inventory_branch_stock holds each branch's quantity of an item, and inventory_items.quantity is the total across
 * branches, changed by the same statement as the branch's own row. The low-stock level is the item's own (inventory_items.min_quantity),
 * the same at every branch: production's inventory_branch_stock has no min_quantity column, so nothing here reads or writes one.
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

/** One item at one branch: the item's own details (its minimum among them), with that branch's quantity. */
export type ItemRow = {
  id: string; name: string; categoryId: string | null; category: string | null; unit: string; quantity: number; minQuantity: number;
  ratePaise: number | null; location: string | null; notes: string | null; active: boolean; low: boolean; branchId: string; branchName: string;
};

/** `branchId`: one branch only (a user's own, or the filter an admin chose); left out, every branch. */
export type ItemFilters = { q?: string; categoryId?: string; low?: boolean; includeInactive?: boolean; branchId?: string };

const isLow = sql<boolean>`${stock.quantity} < ${inventoryItems.minQuantity}`;

/** The items each branch keeps, one row per item and branch: the low ones first, then by name and branch. */
export async function listItems(f: ItemFilters): Promise<ItemRow[]> {
  const where: SQL[] = [];
  if (!f.includeInactive) where.push(eq(inventoryItems.active, true));
  if (f.q?.trim()) where.push(ilike(inventoryItems.name, `%${f.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`));
  if (f.categoryId) where.push(eq(inventoryItems.categoryId, f.categoryId));
  if (f.low) where.push(lt(stock.quantity, inventoryItems.minQuantity));
  if (f.branchId) where.push(eq(stock.branchId, f.branchId));
  return db
    .select({
      id: inventoryItems.id, name: inventoryItems.name, categoryId: inventoryItems.categoryId, category: inventoryCategories.name, unit: inventoryItems.unit,
      quantity: stock.quantity, minQuantity: inventoryItems.minQuantity, ratePaise: inventoryItems.ratePaise, location: inventoryItems.location,
      notes: inventoryItems.notes, active: inventoryItems.active, low: isLow, branchId: stock.branchId, branchName: branches.name,
    })
    .from(stock)
    .innerJoin(inventoryItems, eq(inventoryItems.id, stock.itemId))
    .innerJoin(branches, eq(branches.id, stock.branchId))
    .leftJoin(inventoryCategories, eq(inventoryCategories.id, inventoryItems.categoryId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(isLow), asc(sql`lower(${inventoryItems.name})`), asc(branches.name))
    .limit(2000);
}

/** The catalogue itself, one row per item whatever its branches: for choosing an item (the stock history's filter, a purchase order line). */
export async function listCatalogue(f: { includeInactive?: boolean } = {}): Promise<{ id: string; name: string; unit: string; ratePaise: number | null }[]> {
  return db.select({ id: inventoryItems.id, name: inventoryItems.name, unit: inventoryItems.unit, ratePaise: inventoryItems.ratePaise }).from(inventoryItems)
    .where(f.includeInactive ? undefined : eq(inventoryItems.active, true)).orderBy(asc(sql`lower(${inventoryItems.name})`)).limit(2000);
}

/**
 * A new item, kept at one branch to begin with. Any starting quantity is written to the ledger as "Opening stock" at that branch, in the
 * same statement.
 */
export async function createItem(v: ItemInput, branch: { id: string; name: string }, actor: Actor) {
  const res = (await db.execute(sql`
    with item as (
      insert into inventory_items (name, category_id, unit, quantity, min_quantity, rate_paise, location, notes, active, branch_id)
      values (${v.name}, ${v.categoryId}, ${v.unit}, ${v.quantity}, ${v.minQuantity}, ${v.rate}, ${v.location}, ${v.notes}, ${v.active}, ${branch.id})
      returning id, name, quantity
    ), at_branch as (
      insert into inventory_branch_stock (item_id, branch_id, quantity) select id, ${branch.id}, quantity from item
    ), opening as (
      insert into inventory_stock_movements (item_id, kind, delta, quantity_after, reason, branch_id, actor_user_id, actor_name)
      select id, 'adjust', quantity, quantity, 'Opening stock', ${branch.id}, ${actor.id}, ${actor.name} from item where quantity > 0
    )
    select id, name from item`)) as unknown as { rows: { id: string; name: string }[] };
  const row = res.rows[0];
  await audit(actor, "item_create", row.id, row.name, { quantity: v.quantity, unit: v.unit, branch: branch.name });
  return row;
}

/**
 * Saves an item's details (its minimum among them), and its quantity at one branch. A changed quantity is a recount at that branch: the difference goes
 * to the ledger in the same statement, against the quantity as it was at that moment (so a change made by someone else in between is not
 * lost from the history), and the item's total moves by the same difference.
 */
export async function updateItem(id: string, v: ItemInput, branch: { id: string; name: string }, actor: Actor) {
  // The old quantity comes from the locked row inside the UPDATE itself (UPDATE … FROM (SELECT … FOR UPDATE)): a separate locking CTE
  // would see the row as already changed by this same statement and return nothing, and a plain read could be stale if someone saved first.
  const res = (await db.execute(sql`
    with at_branch as (
      update inventory_branch_stock b set quantity = ${v.quantity}
      from (select item_id, branch_id, quantity from inventory_branch_stock where item_id = ${id} and branch_id = ${branch.id} for update) old
      where b.item_id = old.item_id and b.branch_id = old.branch_id
      returning old.quantity as before
    ), item as (
      update inventory_items set name = ${v.name}, category_id = ${v.categoryId}, unit = ${v.unit}, quantity = quantity + (${v.quantity} - (select before from at_branch)),
        min_quantity = ${v.minQuantity}, rate_paise = ${v.rate}, location = ${v.location}, notes = ${v.notes}, active = ${v.active}
      where id = ${id} and exists (select 1 from at_branch)
      returning name
    ), recount as (
      insert into inventory_stock_movements (item_id, kind, delta, quantity_after, reason, branch_id, actor_user_id, actor_name)
      select ${id}, 'recount', ${v.quantity} - at_branch.before, ${v.quantity}, 'Changed on the item', ${branch.id}, ${actor.id}, ${actor.name}
      from at_branch where at_branch.before <> ${v.quantity}
    )
    select (select name from item) as name, (select before from at_branch) as before`)) as unknown as { rows: { name: string | null; before: number | null }[] };
  const row = res.rows[0];
  if (!row?.name || row.before == null) throw new InventoryError("That item is not kept at this branch any more. Reload and try again.", 404);
  await audit(actor, "item_update", id, row.name, row.before !== v.quantity ? { branch: branch.name, quantity: { from: row.before, to: v.quantity } } : { branch: branch.name });
}

/** Starts keeping an existing item at another branch, with its opening stock there ("Opening stock" in the ledger). */
export async function addItemToBranch(id: string, v: { quantity: number }, branch: { id: string; name: string }, actor: Actor) {
  const res = (await db.execute(sql`
    with at_branch as (
      insert into inventory_branch_stock (item_id, branch_id, quantity)
      select id, ${branch.id}, ${v.quantity} from inventory_items where id = ${id}
      on conflict (item_id, branch_id) do nothing
      returning item_id
    ), item as (
      update inventory_items set quantity = quantity + ${v.quantity} where id = ${id} and exists (select 1 from at_branch) returning name
    ), opening as (
      insert into inventory_stock_movements (item_id, kind, delta, quantity_after, reason, branch_id, actor_user_id, actor_name)
      select ${id}, 'adjust', ${v.quantity}, ${v.quantity}, 'Opening stock', ${branch.id}, ${actor.id}, ${actor.name} from at_branch where ${v.quantity} > 0
    )
    select (select name from item) as name, (select count(*) from inventory_items where id = ${id})::int as found`)) as unknown as { rows: { name: string | null; found: number }[] };
  const row = res.rows[0];
  if (!row?.found) throw new InventoryError("That item no longer exists. Reload and try again.", 404);
  if (!row.name) throw new InventoryError(`${branch.name} already keeps this item. Edit it there instead.`, 409);
  await audit(actor, "item_branch_added", id, row.name, { branch: branch.name, quantity: v.quantity });
}

/**
 * Removes an item for good, together with everything that refers to it: its stock at every branch, its stock movements (issues, returns,
 * inward goods, adjustments, recounts, transfers), its transfers, its requests and its purchase-order lines. ONE statement, so it all goes
 * or none of it does. What was removed is counted in the audit entry. (To hide an item but keep its history, untick Active instead.)
 */
export async function deleteItem(id: string, actor: Actor) {
  const res = (await db.execute(sql`
    with movements as (
      delete from inventory_stock_movements where item_id = ${id} returning id
    ), requests as (
      delete from inventory_requests where item_id = ${id} returning id
    ), po_lines as (
      delete from inventory_purchase_order_lines where item_id = ${id} returning id
    ), transfers as (
      delete from inventory_transfers where item_id = ${id} returning id
    ), at_branches as (
      delete from inventory_branch_stock where item_id = ${id} returning branch_id
    ), gone as (
      delete from inventory_items where id = ${id} returning name
    )
    select (select name from gone) as name, (select count(*) from movements)::int as movements, (select count(*) from requests)::int as requests,
      (select count(*) from po_lines)::int as po_lines, (select count(*) from transfers)::int as transfers, (select count(*) from at_branches)::int as branches`)) as unknown as {
    rows: { name: string | null; movements: number; requests: number; po_lines: number; transfers: number; branches: number }[];
  };
  const row = res.rows[0];
  if (!row?.name) throw new InventoryError("That item no longer exists. Reload and try again.", 404);
  await audit(actor, "item_delete", id, row.name, { stockMovements: row.movements, requests: row.requests, purchaseOrderLines: row.po_lines, transfers: row.transfers, branches: row.branches });
  return { movements: row.movements, requests: row.requests, purchaseOrderLines: row.po_lines };
}

/* ---------------------------------------------------------------- dashboard */

export type DashboardStats = { items: number; units: number; valuePaise: number; lowStock: number; pendingRequests: number; openTickets: number };

/**
 * The dashboard's numbers, from the active items only, in one round trip: every branch together, or one branch. Low on stock counts each
 * item at each branch that is below the item's minimum. Maintenance tickets are not kept per branch, so they are always the total.
 */
export async function dashboardStats(branchId?: string): Promise<DashboardStats> {
  const atBranch = branchId ? sql`and b.branch_id = ${branchId}` : sql``;
  const res = (await db.execute(sql`
    select
      (select count(distinct b.item_id) from inventory_branch_stock b join inventory_items i on i.id = b.item_id where i.active ${atBranch})::int as items,
      (select coalesce(sum(b.quantity), 0) from inventory_branch_stock b join inventory_items i on i.id = b.item_id where i.active ${atBranch})::bigint as units,
      (select coalesce(sum(b.quantity::bigint * coalesce(i.rate_paise, 0)), 0) from inventory_branch_stock b join inventory_items i on i.id = b.item_id where i.active ${atBranch})::bigint as value_paise,
      (select count(*) from inventory_branch_stock b join inventory_items i on i.id = b.item_id where i.active and b.quantity < i.min_quantity ${atBranch})::int as low_stock,
      (select count(*) from inventory_requests where status = 'pending' ${branchId ? sql`and branch_id = ${branchId}` : sql``})::int as pending_requests,
      (select count(*) from inventory_maintenance_tickets where status <> 'resolved')::int as open_tickets`)) as unknown as {
    rows: { items: number; units: string | number; value_paise: string | number; low_stock: number; pending_requests: number; open_tickets: number }[];
  };
  const r = res.rows[0];
  return { items: Number(r.items), units: Number(r.units), valuePaise: Number(r.value_paise), lowStock: Number(r.low_stock), pendingRequests: Number(r.pending_requests), openTickets: Number(r.open_tickets) };
}

export async function lowStockItems(limit = 8, branchId?: string) {
  return db
    .select({ id: inventoryItems.id, name: inventoryItems.name, unit: inventoryItems.unit, quantity: stock.quantity, minQuantity: inventoryItems.minQuantity, branchId: stock.branchId, branchName: branches.name })
    .from(stock)
    .innerJoin(inventoryItems, eq(inventoryItems.id, stock.itemId))
    .innerJoin(branches, eq(branches.id, stock.branchId))
    .where(and(eq(inventoryItems.active, true), lt(stock.quantity, inventoryItems.minQuantity), branchId ? eq(stock.branchId, branchId) : undefined))
    .orderBy(sql`${stock.quantity}::float / greatest(${inventoryItems.minQuantity}, 1)`, asc(inventoryItems.name))
    .limit(limit);
}

export async function recentMovements(limit = 8, branchId?: string) {
  return db
    .select({
      id: inventoryStockMovements.id, kind: inventoryStockMovements.kind, delta: inventoryStockMovements.delta, item: inventoryItems.name,
      reason: inventoryStockMovements.reason, issuedToName: inventoryStockMovements.issuedToName, eventName: inventoryStockMovements.eventName,
      actorName: inventoryStockMovements.actorName, createdAt: inventoryStockMovements.createdAt, branchName: branches.name,
    })
    .from(inventoryStockMovements)
    .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryStockMovements.itemId))
    .innerJoin(branches, eq(branches.id, inventoryStockMovements.branchId))
    .where(branchId ? eq(inventoryStockMovements.branchId, branchId) : undefined)
    .orderBy(desc(inventoryStockMovements.createdAt))
    .limit(limit);
}
