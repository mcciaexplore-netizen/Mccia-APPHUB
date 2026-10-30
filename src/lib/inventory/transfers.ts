import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { writeAudit } from "@/lib/audit";
import { writeInventoryAudit } from "./audit";
import { InventoryError } from "./errors";
import type { InventoryUser } from "./host-adapter";
import type { TransferInput } from "./validation";

/**
 * Moving stock between branches (Inventory admins). ONE statement: the source branch's stock goes down only if it has enough, the
 * destination's goes up (it starts keeping the item if it did not), the transfer is recorded, and a "transfer" movement is written at each
 * branch. The item's total does not change. Not enough at the source: nothing changes.
 */

type Actor = Pick<InventoryUser, "id" | "name">;

export type TransferRow = { id: string; item: string; unit: string; fromBranch: string; toBranch: string; quantity: number; reason: string | null; actorName: string; createdAt: Date };

export async function listTransfers(limit = 200): Promise<TransferRow[]> {
  const res = (await db.execute(sql`
    select t.id, i.name as item, i.unit, f.name as from_branch, d.name as to_branch, t.quantity, t.reason, t.actor_name, t.created_at
    from inventory_transfers t
    join inventory_items i on i.id = t.item_id
    join branches f on f.id = t.from_branch_id
    join branches d on d.id = t.to_branch_id
    order by t.created_at desc
    limit ${limit}`)) as unknown as { rows: Record<string, unknown>[] };
  return res.rows.map((r) => ({
    id: String(r.id), item: String(r.item), unit: String(r.unit), fromBranch: String(r.from_branch), toBranch: String(r.to_branch), quantity: Number(r.quantity),
    reason: (r.reason as string) ?? null, actorName: String(r.actor_name), createdAt: new Date(r.created_at as string),
  }));
}

/** Both branches must be active branches of the hub; the item must be active and kept at the source. */
export async function transferStock(v: TransferInput, actor: Actor) {
  const res = (await db.execute(sql`
    with branch_names as (
      select (select name from branches where id = ${v.fromBranchId} and is_active) as from_name, (select name from branches where id = ${v.toBranchId} and is_active) as to_name
    ), source as (
      update inventory_branch_stock b set quantity = b.quantity - ${v.quantity}
      from inventory_items i, branch_names n
      where i.id = b.item_id and b.item_id = ${v.itemId} and b.branch_id = ${v.fromBranchId} and i.active and b.quantity >= ${v.quantity}
        and n.from_name is not null and n.to_name is not null
      returning b.item_id, i.name as item, b.quantity as after
    ), dest as (
      insert into inventory_branch_stock (item_id, branch_id, quantity) select item_id, ${v.toBranchId}, ${v.quantity} from source
      on conflict (item_id, branch_id) do update set quantity = inventory_branch_stock.quantity + excluded.quantity
      returning quantity as after
    ), transfer as (
      insert into inventory_transfers (item_id, from_branch_id, to_branch_id, quantity, reason, actor_id, actor_name)
      select item_id, ${v.fromBranchId}, ${v.toBranchId}, ${v.quantity}, ${v.reason}, ${actor.id}, ${actor.name} from source
      returning id
    ), movements as (
      insert into inventory_stock_movements (item_id, kind, delta, quantity_after, reason, branch_id, actor_user_id, actor_name)
      -- Typed: in a UNION, plain values would be taken as text.
      select source.item_id, 'transfer'::inventory_movement_kind, ${-v.quantity}::int, source.after, 'Transfer to ' || n.to_name || coalesce(': ' || ${v.reason}::text, ''),
        ${v.fromBranchId}::uuid, ${actor.id}::uuid, ${actor.name}::text
      from source, branch_names n
      union all
      select source.item_id, 'transfer'::inventory_movement_kind, ${v.quantity}::int, dest.after, 'Transfer from ' || n.from_name || coalesce(': ' || ${v.reason}::text, ''),
        ${v.toBranchId}::uuid, ${actor.id}::uuid, ${actor.name}::text
      from source, dest, branch_names n
      returning id
    )
    select (select id from transfer) as id, (select item from source) as item, (select from_name from branch_names) as from_name, (select to_name from branch_names) as to_name,
      (select count(*) from movements)::int as movements`)) as unknown as { rows: { id: string | null; item: string | null; from_name: string | null; to_name: string | null; movements: number }[] };
  const row = res.rows[0];
  if (row?.id && row.item) {
    await writeAudit(actor, [{ action: "inventory.stock_transferred", targetType: "system", targetId: row.id, targetLabel: row.item,
      details: { quantity: v.quantity, from: row.from_name, to: row.to_name, reason: v.reason } }]);
    // Filed under the branch the stock left; the destination is in the details.
    await writeInventoryAudit(actor, "stock_transferred", { targetType: "item", targetId: v.itemId, targetLabel: row.item, branchId: v.fromBranchId,
      details: { from: row.from_name, to: row.to_name, quantity: v.quantity, reason: v.reason } });
    return { id: row.id };
  }
  if (!row?.from_name || !row.to_name) throw new InventoryError("One of those branches is not available. Reload and try again.", 404);
  const [it] = (await db.execute(sql`
    select i.name, i.active, b.quantity from inventory_items i left join inventory_branch_stock b on b.item_id = i.id and b.branch_id = ${v.fromBranchId}
    where i.id = ${v.itemId}`) as unknown as { rows: { name: string; active: boolean; quantity: number | null }[] }).rows;
  if (!it || !it.active) throw new InventoryError("That item is not available. Reload and try again.", 404);
  if (it.quantity == null) throw new InventoryError(`${row.from_name} does not keep this item. Nothing was changed.`, 409);
  throw new InventoryError(`Not enough at ${row.from_name}: ${v.quantity} to move, ${it.quantity} there. Nothing was changed.`, 409);
}
