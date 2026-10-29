import "server-only";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { inventoryItems, inventoryRequests } from "@/db/inventory-schema";
import { writeAudit } from "@/lib/audit";
import { InventoryError } from "./errors";
import type { InventoryUser } from "./host-adapter";

/**
 * Requisitions: anyone signed in asks the store for an item; store staff approve, reject (with a reason) or fulfil.
 * pending → approved → fulfilled, or pending → rejected. Every step is a conditional update on the status it starts from, so two people
 * acting at once cannot both succeed. Fulfilling takes the stock out, writes the issue movement and closes the request in ONE statement.
 */

type Actor = Pick<InventoryUser, "id" | "name">;
const audit = (actor: Actor, action: string, id: string, label: string, details: Record<string, unknown> = {}) =>
  writeAudit(actor, [{ action: `inventory.${action}`, targetType: "system", targetId: id, targetLabel: label, details }]);

export const REQUEST_STATUSES = ["pending", "approved", "fulfilled", "rejected"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export type RequestRow = {
  id: string; itemId: string; item: string; unit: string; inStock: number; quantity: number; note: string | null; status: string;
  requestedByUserId: string; requestedByName: string; requestedAt: Date; resolvedByName: string | null; resolvedAt: Date | null; rejectReason: string | null;
};

/** Everyone's requests (store staff), or only the person's own. Newest first; waiting ones first when not filtered. */
export async function listRequests(f: { mineOnly?: string; status?: RequestStatus }): Promise<RequestRow[]> {
  const where: SQL[] = [];
  if (f.mineOnly) where.push(eq(inventoryRequests.requestedByUserId, f.mineOnly));
  if (f.status) where.push(eq(inventoryRequests.status, f.status));
  return db
    .select({
      id: inventoryRequests.id, itemId: inventoryRequests.itemId, item: inventoryItems.name, unit: inventoryItems.unit, inStock: inventoryItems.quantity,
      quantity: inventoryRequests.quantity, note: inventoryRequests.note, status: inventoryRequests.status,
      requestedByUserId: inventoryRequests.requestedByUserId, requestedByName: inventoryRequests.requestedByName, requestedAt: inventoryRequests.requestedAt,
      resolvedByName: inventoryRequests.resolvedByName, resolvedAt: inventoryRequests.resolvedAt, rejectReason: inventoryRequests.rejectReason,
    })
    .from(inventoryRequests)
    .innerJoin(inventoryItems, eq(inventoryItems.id, inventoryRequests.itemId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(sql`case ${inventoryRequests.status} when 'pending' then 0 when 'approved' then 1 else 2 end`, desc(inventoryRequests.requestedAt))
    .limit(1000);
}

export async function statusCounts(): Promise<Record<RequestStatus, number>> {
  const rows = await db.select({ status: inventoryRequests.status, n: sql<number>`count(*)`.mapWith(Number) }).from(inventoryRequests).groupBy(inventoryRequests.status);
  const out = { pending: 0, approved: 0, fulfilled: 0, rejected: 0 };
  for (const r of rows) if (r.status in out) out[r.status as RequestStatus] = r.n;
  return out;
}

/** Raises a request for an active item. */
export async function createRequest(v: { itemId: string; quantity: number; note: string | null }, actor: Actor) {
  const res = (await db.execute(sql`
    insert into inventory_requests (item_id, quantity, note, requested_by_user_id, requested_by_name)
    select id, ${v.quantity}, ${v.note}, ${actor.id}, ${actor.name} from inventory_items where id = ${v.itemId} and active
    returning id, (select name from inventory_items where id = ${v.itemId}) as item`)) as unknown as { rows: { id: string; item: string }[] };
  const row = res.rows[0];
  if (!row) throw new InventoryError("That item is not available to request. Reload and try again.", 404);
  await audit(actor, "request_raised", row.id, row.item, { quantity: v.quantity });
  return row;
}

/** What a request is now, to explain why a step did not apply. */
async function currentStatus(id: string) {
  const [r] = await db.select({ status: inventoryRequests.status, item: inventoryItems.name, quantity: inventoryRequests.quantity, inStock: inventoryItems.quantity })
    .from(inventoryRequests).innerJoin(inventoryItems, eq(inventoryItems.id, inventoryRequests.itemId)).where(eq(inventoryRequests.id, id));
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
}

/**
 * Hands an approved request over: in ONE statement the request is locked, the stock is taken out only if there is enough, an issue
 * movement to the requester is written, and the request is marked fulfilled and linked to it. Not enough stock: nothing changes.
 * The request is locked inside the stock UPDATE (UPDATE … FROM (SELECT … FOR UPDATE)), so a second fulfil at the same moment waits,
 * then finds it no longer approved and changes nothing.
 */
export async function fulfilRequest(id: string, actor: Actor) {
  const res = (await db.execute(sql`
    with stock as (
      update inventory_items i set quantity = i.quantity - r.quantity
      from (select id, item_id, quantity, requested_by_user_id, requested_by_name from inventory_requests where id = ${id} and status = 'approved' for update) r
      where i.id = r.item_id and i.quantity >= r.quantity
      returning i.id as item_id, i.name as item, i.quantity as after, r.quantity as qty, r.requested_by_user_id as to_user, r.requested_by_name as to_name
    ), movement as (
      insert into inventory_stock_movements (item_id, kind, delta, quantity_after, reason, issued_to_user_id, issued_to_name, request_id, actor_user_id, actor_name)
      select item_id, 'issue', -qty, after, 'Request fulfilled', to_user, to_name, ${id}, ${actor.id}, ${actor.name} from stock
      returning id
    ), done as (
      update inventory_requests set status = 'fulfilled', fulfilled_movement_id = (select id from movement),
        resolved_by_user_id = ${actor.id}, resolved_by_name = ${actor.name}, resolved_at = now()
      where id = ${id} and exists (select 1 from movement)
      returning id
    )
    select (select item from stock) as item, (select qty from stock) as qty, (select after from stock) as after, (select count(*) from done)::int as done`)) as unknown as {
    rows: { item: string | null; qty: number | null; after: number | null; done: number }[];
  };
  const row = res.rows[0];
  if (row?.done === 1 && row.item) {
    await audit(actor, "request_fulfilled", id, row.item, { quantity: row.qty, stockAfter: row.after });
    return;
  }
  const cur = await currentStatus(id);
  if (cur.status !== "approved") throw notNow(cur.status, "fulfilled");
  throw new InventoryError(`Not enough in stock: ${cur.quantity} requested, ${cur.inStock} available. Nothing was changed.`, 409);
}
