import "server-only";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { branches } from "@/db/schema";
import { inventoryBranchStock, inventoryItems, inventoryRequests } from "@/db/inventory-schema";
import { writeAudit } from "@/lib/audit";
import { writeInventoryAudit } from "./audit";
import { NO_BRANCH_MESSAGE } from "./branches";
import { InventoryError } from "./errors";
import type { InventoryUser } from "./host-adapter";

/**
 * Requisitions: anyone signed in asks the store for an item; Inventory admins approve, reject (with a reason) or fulfil.
 * pending → approved → fulfilled, or pending → rejected. Every step is a conditional update on the status it starts from, so two people
 * acting at once cannot both succeed. Fulfilling takes the stock out, writes the issue movement and closes the request in ONE statement.
 * A request belongs to the requester's branch: it can only be for an item that branch keeps, and it is fulfilled from that branch's stock.
 */

type Actor = Pick<InventoryUser, "id" | "name">;
const audit = (actor: Actor, action: string, id: string, label: string, details: Record<string, unknown> = {}) =>
  writeAudit(actor, [{ action: `inventory.${action}`, targetType: "system", targetId: id, targetLabel: label, details }]);

export const REQUEST_STATUSES = ["pending", "approved", "fulfilled", "rejected"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export type RequestRow = {
  id: string; itemId: string; item: string; unit: string; branchId: string; branchName: string; /** At the request's branch. */ inStock: number; quantity: number; note: string | null; status: string;
  requestedByUserId: string; requestedByName: string; requestedAt: Date; resolvedByName: string | null; resolvedAt: Date | null; rejectReason: string | null;
};

/** Everyone's requests (Inventory admins and Staff, every branch or one), or only the person's own. Newest first; waiting ones first when not filtered. */
export async function listRequests(f: { mineOnly?: string; status?: RequestStatus; branchId?: string }): Promise<RequestRow[]> {
  const where: SQL[] = [];
  if (f.mineOnly) where.push(eq(inventoryRequests.requestedByUserId, f.mineOnly));
  if (f.status) where.push(eq(inventoryRequests.status, f.status));
  if (f.branchId) where.push(eq(inventoryRequests.branchId, f.branchId));
  return db
    .select({
      id: inventoryRequests.id, itemId: inventoryRequests.itemId, item: inventoryItems.name, unit: inventoryItems.unit, branchId: inventoryRequests.branchId, branchName: branches.name,
      inStock: sql<number>`coalesce(${inventoryBranchStock.quantity}, 0)`.mapWith(Number),
      quantity: inventoryRequests.quantity, note: inventoryRequests.note, status: inventoryRequests.status,
      requestedByUserId: inventoryRequests.requestedByUserId, requestedByName: inventoryRequests.requestedByName, requestedAt: inventoryRequests.requestedAt,
      resolvedByName: inventoryRequests.resolvedByName, resolvedAt: inventoryRequests.resolvedAt, rejectReason: inventoryRequests.rejectReason,
    })
    .from(inventoryRequests)
    .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryRequests.itemId))
    .innerJoin(branches, eq(branches.id, inventoryRequests.branchId))
    .leftJoin(inventoryBranchStock, and(eq(inventoryBranchStock.itemId, inventoryRequests.itemId), eq(inventoryBranchStock.branchId, inventoryRequests.branchId)))
    .where(where.length ? and(...where) : undefined)
    .orderBy(sql`case ${inventoryRequests.status} when 'pending' then 0 when 'approved' then 1 else 2 end`, desc(inventoryRequests.requestedAt))
    .limit(1000);
}

export async function statusCounts(branchId?: string): Promise<Record<RequestStatus, number>> {
  const rows = await db.select({ status: inventoryRequests.status, n: sql<number>`count(*)`.mapWith(Number) }).from(inventoryRequests)
    .where(branchId ? eq(inventoryRequests.branchId, branchId) : undefined).groupBy(inventoryRequests.status);
  const out = { pending: 0, approved: 0, fulfilled: 0, rejected: 0 };
  for (const r of rows) if (r.status in out) out[r.status as RequestStatus] = r.n;
  return out;
}

/** Raises a request, at the requester's own branch, for an active item that branch keeps. Someone with no branch cannot request. */
export async function createRequest(v: { itemId: string; quantity: number; note: string | null }, actor: Actor & Pick<InventoryUser, "branchId">) {
  if (!actor.branchId) throw new InventoryError(NO_BRANCH_MESSAGE, 409);
  const res = (await db.execute(sql`
    insert into inventory_requests (item_id, quantity, note, requested_by_user_id, requested_by_name, branch_id)
    select i.id, ${v.quantity}, ${v.note}, ${actor.id}, ${actor.name}, b.branch_id
    from inventory_items i join inventory_branch_stock b on b.item_id = i.id and b.branch_id = ${actor.branchId}
    where i.id = ${v.itemId} and i.active
    returning id, (select name from inventory_items where id = ${v.itemId}) as item`)) as unknown as { rows: { id: string; item: string }[] };
  const row = res.rows[0];
  if (!row) throw new InventoryError("That item is not available to request at your branch. Reload and try again.", 404);
  await audit(actor, "request_raised", row.id, row.item, { quantity: v.quantity });
  await writeInventoryAudit(actor, "request_created", { targetType: "request", targetId: row.id, targetLabel: row.item, branchId: actor.branchId, details: { requester: actor.name, item: row.item, quantity: v.quantity } });
  return row;
}

/** What a request is now, to explain why a step did not apply. */
async function currentStatus(id: string) {
  const [r] = await db.select({ status: inventoryRequests.status, item: inventoryItems.name, quantity: inventoryRequests.quantity, branchId: inventoryRequests.branchId, requester: inventoryRequests.requestedByName, inStock: sql<number>`coalesce(${inventoryBranchStock.quantity}, 0)`.mapWith(Number) })
    .from(inventoryRequests).innerJoin(inventoryItems, eq(inventoryItems.id, inventoryRequests.itemId))
    .leftJoin(inventoryBranchStock, and(eq(inventoryBranchStock.itemId, inventoryRequests.itemId), eq(inventoryBranchStock.branchId, inventoryRequests.branchId)))
    .where(eq(inventoryRequests.id, id));
  if (!r) throw new InventoryError("That request no longer exists. Reload and try again.", 404);
  return r;
}
const notNow = (status: string, step: string) => new InventoryError(`This request is ${status} now, so it can't be ${step}. Reload to see the latest.`, 409);

export async function approveRequest(id: string, actor: Actor) {
  const [row] = await db.update(inventoryRequests).set({ status: "approved", resolvedByUserId: actor.id, resolvedByName: actor.name, resolvedAt: new Date() })
    .where(and(eq(inventoryRequests.id, id), eq(inventoryRequests.status, "pending"))).returning({ id: inventoryRequests.id });
  const cur = await currentStatus(id);
  if (!row) throw notNow(cur.status, "approved");
  await audit(actor, "request_approved", id, cur.item, { quantity: cur.quantity });
}

export async function rejectRequest(id: string, reason: string, actor: Actor) {
  const [row] = await db.update(inventoryRequests).set({ status: "rejected", rejectReason: reason, resolvedByUserId: actor.id, resolvedByName: actor.name, resolvedAt: new Date() })
    .where(and(eq(inventoryRequests.id, id), eq(inventoryRequests.status, "pending"))).returning({ id: inventoryRequests.id });
  const cur = await currentStatus(id);
  if (!row) throw notNow(cur.status, "rejected");
  await audit(actor, "request_rejected", id, cur.item, { quantity: cur.quantity, reason });
  await writeInventoryAudit(actor, "request_rejected", { targetType: "request", targetId: id, targetLabel: cur.item, branchId: cur.branchId, details: { item: cur.item, requester: cur.requester, quantity: cur.quantity, reason } });
}

/**
 * Hands an approved request over: in ONE statement the request is locked, the stock at its branch is taken out only if there is enough, an issue
 * movement to the requester is written, and the request is marked fulfilled and linked to it. Not enough stock: nothing changes.
 * The request is locked inside the stock UPDATE (UPDATE … FROM (SELECT … FOR UPDATE)), so a second fulfil at the same moment waits,
 * then finds it no longer approved and changes nothing.
 */
export async function fulfilRequest(id: string, actor: Actor) {
  const res = (await db.execute(sql`
    with stock as (
      update inventory_branch_stock b set quantity = b.quantity - r.quantity
      from (select id, item_id, branch_id, quantity, requested_by_user_id, requested_by_name from inventory_requests where id = ${id} and status = 'approved' for update) r
      where b.item_id = r.item_id and b.branch_id = r.branch_id and b.quantity >= r.quantity
      returning b.item_id, b.branch_id, b.quantity as after, r.quantity as qty, r.requested_by_user_id as to_user, r.requested_by_name as to_name
    ), total as (
      update inventory_items i set quantity = i.quantity - stock.qty from stock where i.id = stock.item_id returning i.name as item
    ), movement as (
      insert into inventory_stock_movements (item_id, kind, delta, quantity_after, reason, issued_to_user_id, issued_to_name, request_id, branch_id, actor_user_id, actor_name)
      select item_id, 'issue', -qty, after, 'Request fulfilled', to_user, to_name, ${id}, branch_id, ${actor.id}, ${actor.name} from stock
      returning id
    ), done as (
      update inventory_requests set status = 'fulfilled', fulfilled_movement_id = (select id from movement),
        resolved_by_user_id = ${actor.id}, resolved_by_name = ${actor.name}, resolved_at = now()
      where id = ${id} and exists (select 1 from movement)
      returning id
    )
    select (select item from total) as item, (select qty from stock) as qty, (select branch_id from stock) as branch_id, (select to_name from stock) as to_name, (select after from stock) as after, (select count(*) from done)::int as done`)) as unknown as {
    rows: { item: string | null; qty: number | null; after: number | null; done: number; branch_id: string | null; to_name: string | null }[];
  };
  const row = res.rows[0];
  if (row?.done === 1 && row.item) {
    await audit(actor, "request_fulfilled", id, row.item, { quantity: row.qty, stockAfter: row.after });
    await writeInventoryAudit(actor, "request_fulfilled", { targetType: "request", targetId: id, targetLabel: row.item, branchId: row.branch_id,
      details: { item: row.item, quantity: row.qty, requester: row.to_name, fulfilledBy: actor.name } });
    return;
  }
  const cur = await currentStatus(id);
  if (cur.status !== "approved") throw notNow(cur.status, "fulfilled");
  throw new InventoryError(`Not enough in stock: ${cur.quantity} requested, ${cur.inStock} available. Nothing was changed.`, 409);
}
