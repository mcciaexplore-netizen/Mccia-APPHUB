import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { branches } from "@/db/schema";
import { inventoryItems, inventoryPurchaseOrderLines, inventoryPurchaseOrders, inventoryStockMovements, inventoryVendors } from "@/db/inventory-schema";
import { writeAudit } from "@/lib/audit";
import { InventoryError } from "./errors";
import type { InventoryUser } from "./host-adapter";
import { PO_STATUSES, nextPoNo, poPrefix, type PoStatus } from "./po-number";
import type { PoInput, ReceiveInput } from "./validation";

/**
 * Purchase orders. draft → sent → received, and draft or sent → cancelled. A draft can be edited; sending fixes it. Receiving records what
 * arrived on each line, adds it to the receiving branch's stock of catalogue items with an "inward" movement (vendor, PO, rate, challan), and closes the PO
 * once everything is in or the admin says nothing more is coming. Every change is ONE statement (the production driver has no
 * transactions). Recorded in the hub's audit log as inventory.po_created / po_updated / po_sent / po_received / po_cancelled.
 */

type Actor = Pick<InventoryUser, "id" | "name">;
const audit = (actor: Actor, action: string, id: string, label: string, details: Record<string, unknown> = {}) =>
  writeAudit(actor, [{ action: `inventory.${action}`, targetType: "system", targetId: id, targetLabel: label, details }]);

export { PO_STATUSES, type PoStatus };

const pgError = (e: unknown) => (e as { cause?: { code?: string; constraint?: string } }).cause ?? (e as { code?: string; constraint?: string });

/* ---------------------------------------------------------------- reading */

export type PoListRow = {
  id: string; poNo: string; vendorName: string; status: PoStatus; lines: number; totalPaise: number; partlyReceived: boolean;
  createdAt: Date; createdByName: string; sentAt: Date | null; receivedAt: Date | null;
};

export async function listPurchaseOrders(status?: PoStatus): Promise<PoListRow[]> {
  const res = (await db.execute(sql`
    select po.id, po.po_no, po.vendor_name, po.status, po.created_at, po.created_by_name, po.sent_at, po.received_at,
      count(l.id)::int as lines, coalesce(sum(l.quantity::bigint * l.rate_paise), 0)::bigint as total,
      coalesce(bool_or(l.received_quantity > 0), false) as any_received
    from inventory_purchase_orders po left join inventory_purchase_order_lines l on l.purchase_order_id = po.id
    ${status ? sql`where po.status = ${status}` : sql``}
    group by po.id
    order by case po.status when 'draft' then 0 when 'sent' then 1 else 2 end, po.created_at desc
    limit 1000`)) as unknown as { rows: Record<string, unknown>[] };
  return res.rows.map((r) => ({
    id: String(r.id), poNo: String(r.po_no), vendorName: String(r.vendor_name), status: r.status as PoStatus, lines: Number(r.lines), totalPaise: Number(r.total),
    partlyReceived: r.status === "sent" && !!r.any_received, createdAt: new Date(r.created_at as string), createdByName: String(r.created_by_name),
    sentAt: r.sent_at ? new Date(r.sent_at as string) : null, receivedAt: r.received_at ? new Date(r.received_at as string) : null,
  }));
}

export async function poStatusCounts(): Promise<Record<PoStatus, number>> {
  const rows = await db.select({ status: inventoryPurchaseOrders.status, n: sql<number>`count(*)`.mapWith(Number) }).from(inventoryPurchaseOrders).groupBy(inventoryPurchaseOrders.status);
  const out = { draft: 0, sent: 0, received: 0, cancelled: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

export async function getPurchaseOrder(id: string) {
  const [po] = await db.select().from(inventoryPurchaseOrders).where(eq(inventoryPurchaseOrders.id, id));
  if (!po) return null;
  const [lines, receipts] = await Promise.all([
    db.select({
      id: inventoryPurchaseOrderLines.id, itemId: inventoryPurchaseOrderLines.itemId, item: inventoryItems.name, unit: inventoryItems.unit,
      description: inventoryPurchaseOrderLines.description, quantity: inventoryPurchaseOrderLines.quantity, ratePaise: inventoryPurchaseOrderLines.ratePaise,
      receivedQuantity: inventoryPurchaseOrderLines.receivedQuantity,
    }).from(inventoryPurchaseOrderLines).leftJoin(inventoryItems, eq(inventoryItems.id, inventoryPurchaseOrderLines.itemId))
      .where(eq(inventoryPurchaseOrderLines.purchaseOrderId, id)).orderBy(asc(inventoryPurchaseOrderLines.sort)),
    db.select({
      id: inventoryStockMovements.id, item: inventoryItems.name, quantity: inventoryStockMovements.delta, challanNo: inventoryStockMovements.challanNo,
      actorName: inventoryStockMovements.actorName, createdAt: inventoryStockMovements.createdAt, branchName: branches.name,
    }).from(inventoryStockMovements).innerJoin(inventoryItems, eq(inventoryItems.id, inventoryStockMovements.itemId))
      .innerJoin(branches, eq(branches.id, inventoryStockMovements.branchId))
      .where(and(eq(inventoryStockMovements.purchaseOrderId, id), eq(inventoryStockMovements.kind, "inward"))).orderBy(desc(inventoryStockMovements.createdAt)),
  ]);
  return { ...po, lines, receipts, totalPaise: lines.reduce((t, l) => t + l.quantity * l.ratePaise, 0) };
}

/* ---------------------------------------------------------------- writing */

/** The vendor's name and email from the directory (an active vendor), or the typed name with no email. */
async function resolveVendor(v: PoInput) {
  if (!v.vendorId) return { vendorId: null, vendorName: v.vendorName!, vendorEmail: null };
  const [vendor] = await db.select({ name: inventoryVendors.name, email: inventoryVendors.email }).from(inventoryVendors)
    .where(and(eq(inventoryVendors.id, v.vendorId), eq(inventoryVendors.active, true)));
  if (!vendor) throw new InventoryError("That vendor is not available (deleted or deactivated). Choose another or type the name.", 409);
  return { vendorId: v.vendorId, vendorName: vendor.name, vendorEmail: vendor.email };
}

/** Every catalogue item on the lines must exist; a line with an item and no description takes the item's name. */
async function checkItems(v: PoInput) {
  const ids = [...new Set(v.lines.map((l) => l.itemId).filter((x): x is string => !!x))];
  if (!ids.length) return;
  const found = await db.select({ id: inventoryItems.id }).from(inventoryItems).where(inArray(inventoryItems.id, ids));
  if (found.length !== ids.length) throw new InventoryError("An item on this order no longer exists. Reload and try again.", 409);
}

const lineValues = (v: PoInput) =>
  sql.join(v.lines.map((l, i) => sql`(${l.itemId}::uuid, ${l.description}::text, ${l.quantity}::int, ${l.rate}::bigint, ${i}::int)`), sql`, `);

/** A new draft with its lines and the next number of the financial year. Two created at the same instant: the second takes the next number. */
export async function createPurchaseOrder(v: PoInput, actor: Actor) {
  const vendor = await resolveVendor(v);
  await checkItems(v);
  const prefix = poPrefix();
  for (let attempt = 0; attempt < 5; attempt++) {
    const [highest] = await db.select({ poNo: inventoryPurchaseOrders.poNo }).from(inventoryPurchaseOrders)
      .where(sql`${inventoryPurchaseOrders.poNo} like ${`${prefix}%`}`).orderBy(desc(sql`length(${inventoryPurchaseOrders.poNo})`), desc(inventoryPurchaseOrders.poNo)).limit(1);
    const poNo = nextPoNo(prefix, highest?.poNo ?? null);
    try {
      const res = (await db.execute(sql`
        with po as (
          insert into inventory_purchase_orders (po_no, vendor_id, vendor_name, vendor_email, notes, created_by_user_id, created_by_name)
          values (${poNo}, ${vendor.vendorId}, ${vendor.vendorName}, ${vendor.vendorEmail}, ${v.notes}, ${actor.id}, ${actor.name})
          returning id, po_no
        ), lines as (
          insert into inventory_purchase_order_lines (purchase_order_id, item_id, description, quantity, rate_paise, sort)
          select po.id, x.item_id, coalesce(x.description, i.name), x.quantity, x.rate, x.sort
          from po cross join (values ${lineValues(v)}) as x(item_id, description, quantity, rate, sort) left join inventory_items i on i.id = x.item_id
        )
        select id, po_no from po`)) as unknown as { rows: { id: string; po_no: string }[] };
      const row = res.rows[0];
      await audit(actor, "po_created", row.id, row.po_no, { vendor: vendor.vendorName, lines: v.lines.length, totalPaise: v.lines.reduce((t, l) => t + l.quantity * l.rate, 0) });
      return { id: row.id, poNo: row.po_no };
    } catch (e) {
      const pg = pgError(e);
      if (pg?.code === "23505" && String(pg.constraint ?? "").includes("po_no")) continue; // someone took that number a moment ago
      throw e;
    }
  }
  throw new InventoryError("Could not give this order a number just now. Please try again.", 409);
}

async function statusOf(id: string) {
  const [po] = await db.select({ status: inventoryPurchaseOrders.status, poNo: inventoryPurchaseOrders.poNo }).from(inventoryPurchaseOrders).where(eq(inventoryPurchaseOrders.id, id));
  if (!po) throw new InventoryError("That purchase order no longer exists. Reload and try again.", 404);
  return po;
}
const notNow = (status: string, step: string) => new InventoryError(`This purchase order is ${status} now, so it can't be ${step}. Reload to see the latest.`, 409);

/** Replaces a draft's vendor, notes and lines, in one statement that only applies while it is still a draft. */
export async function updateDraft(id: string, v: PoInput, actor: Actor) {
  const vendor = await resolveVendor(v);
  await checkItems(v);
  const res = (await db.execute(sql`
    with po as (
      update inventory_purchase_orders set vendor_id = ${vendor.vendorId}, vendor_name = ${vendor.vendorName}, vendor_email = ${vendor.vendorEmail}, notes = ${v.notes}
      where id = ${id} and status = 'draft' returning id, po_no
    ), gone as (
      delete from inventory_purchase_order_lines where purchase_order_id = (select id from po)
    ), lines as (
      insert into inventory_purchase_order_lines (purchase_order_id, item_id, description, quantity, rate_paise, sort)
      select po.id, x.item_id, coalesce(x.description, i.name), x.quantity, x.rate, x.sort
      from po cross join (values ${lineValues(v)}) as x(item_id, description, quantity, rate, sort) left join inventory_items i on i.id = x.item_id
    )
    select po_no from po`)) as unknown as { rows: { po_no: string }[] };
  const row = res.rows[0];
  if (!row) throw notNow((await statusOf(id)).status, "edited");
  await audit(actor, "po_updated", id, row.po_no, { vendor: vendor.vendorName, lines: v.lines.length });
}

export async function sendPurchaseOrder(id: string, actor: Actor) {
  const [row] = await db.update(inventoryPurchaseOrders).set({ status: "sent", sentAt: new Date() })
    .where(and(eq(inventoryPurchaseOrders.id, id), eq(inventoryPurchaseOrders.status, "draft"),
      sql`exists (select 1 from inventory_purchase_order_lines l where l.purchase_order_id = ${id})`))
    .returning({ poNo: inventoryPurchaseOrders.poNo, vendorName: inventoryPurchaseOrders.vendorName });
  if (!row) {
    const cur = await statusOf(id);
    throw cur.status === "draft" ? new InventoryError("Add at least one line before sending.", 409) : notNow(cur.status, "sent");
  }
  await audit(actor, "po_sent", id, row.poNo ?? "", { vendor: row.vendorName });
}

/** Only a draft or a sent order can be cancelled. Anything already received on a sent order stays in stock. */
export async function cancelPurchaseOrder(id: string, actor: Actor) {
  const res = (await db.execute(sql`
    update inventory_purchase_orders po set status = 'cancelled'
    from (select id, status from inventory_purchase_orders where id = ${id} and status in ('draft', 'sent') for update) old
    where po.id = old.id
    returning po.po_no, old.status as was`)) as unknown as { rows: { po_no: string; was: string }[] };
  const row = res.rows[0];
  if (!row) throw notNow((await statusOf(id)).status, "cancelled");
  await audit(actor, "po_cancelled", id, row.po_no, { was: row.was });
}

/**
 * Records goods arriving on a sent order at one branch, in ONE statement: each line's received quantity goes up (never past what was
 * ordered), the branch's stock of each catalogue item goes up by what arrived (the branch starts keeping an item it did not have), an inward movement is written per line (vendor, PO, rate, challan), and the order
 * becomes received when nothing is left to come or `close` says nothing more will. Any line asked for more than is left: nothing changes.
 */
export async function receivePurchaseOrder(id: string, v: ReceiveInput, branch: { id: string; name: string }, actor: Actor) {
  const input = v.lines.length
    ? sql`select * from (values ${sql.join(v.lines.map((l) => sql`(${l.lineId}::uuid, ${l.quantity}::int)`), sql`, `)}) as x(line_id, qty)`
    : sql`select null::uuid as line_id, null::int as qty where false`;
  const res = (await db.execute(sql`
    with input as (${input}),
    po as (
      select id, vendor_id, po_no from inventory_purchase_orders where id = ${id} and status = 'sent'
    ), ok as (
      select (select count(*) from po) = 1
        and (select count(*) from input i join inventory_purchase_order_lines l on l.id = i.line_id and l.purchase_order_id = ${id} and l.received_quantity + i.qty <= l.quantity)
          = (select count(*) from input) as ok
    ), recv as (
      update inventory_purchase_order_lines l set received_quantity = l.received_quantity + i.qty
      from input i
      where l.id = i.line_id and l.purchase_order_id = ${id} and (select ok from ok) and l.received_quantity + i.qty <= l.quantity
      returning l.id, l.item_id, i.qty, l.rate_paise
    ), per_item as (
      select item_id, sum(qty)::int as qty from recv where item_id is not null group by item_id
    ), stock as (
      insert into inventory_branch_stock (item_id, branch_id, quantity) select item_id, ${branch.id}, qty from per_item
      on conflict (item_id, branch_id) do update set quantity = inventory_branch_stock.quantity + excluded.quantity
      returning item_id as id, quantity
    ), total as (
      update inventory_items it set quantity = it.quantity + p.qty from per_item p where it.id = p.item_id
    ), movement as (
      insert into inventory_stock_movements (item_id, kind, delta, quantity_after, reason, vendor_id, purchase_order_id, challan_no, rate_paise, branch_id, actor_user_id, actor_name)
      select r.item_id, 'inward', r.qty, s.quantity, 'Received on ' || po.po_no, po.vendor_id, ${id}, ${v.challanNo}, r.rate_paise, ${branch.id}, ${actor.id}, ${actor.name}
      from recv r join stock s on s.id = r.item_id cross join po
      returning id
    ), remaining as (
      select coalesce(bool_or(l.quantity > l.received_quantity + coalesce(i.qty, 0)), false) as left_to_come
      from inventory_purchase_order_lines l left join input i on i.line_id = l.id where l.purchase_order_id = ${id}
    ), closed as (
      update inventory_purchase_orders set status = 'received', received_at = now()
      where id = ${id} and status = 'sent' and (select ok from ok) and (${v.close} or not (select left_to_come from remaining))
      returning id
    )
    select (select ok from ok) as ok, (select po_no from po) as po_no, (select count(*) from recv)::int as lines, (select count(*) from movement)::int as movements,
      (select count(*) from closed)::int as closed`)) as unknown as { rows: { ok: boolean; po_no: string | null; lines: number; movements: number; closed: number }[] };
  const row = res.rows[0];
  if (!row?.ok) {
    const cur = await statusOf(id);
    if (cur.status !== "sent") throw notNow(cur.status, "received");
    throw new InventoryError("A line was given more than is still to come. Reload to see what has already arrived; nothing was changed.", 409);
  }
  if (row.lines > 0 || row.closed === 1) {
    await audit(actor, "po_received", id, row.po_no ?? "", { lines: row.lines, stockMovements: row.movements, challanNo: v.challanNo, closed: row.closed === 1, branch: branch.name });
  }
  // Someone recorded a receipt on the same lines at the same moment: theirs counted first, and a line that would now go past what was
  // ordered was left out (each line is checked again as it is updated). Say so rather than report a success.
  if (row.lines < v.lines.length) {
    throw new InventoryError(`Someone recorded goods on this order at the same moment, so ${v.lines.length - row.lines} of these lines could not be added. Reload to see what has arrived.`, 409);
  }
  return { closed: row.closed === 1, lines: row.lines };
}
