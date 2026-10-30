import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { writeAudit } from "@/lib/audit";
import { InventoryError } from "./errors";
import { listUsers, type InventoryUser } from "./host-adapter";
import type { IssueInput } from "./validation";

/**
 * Issues and returns. An issue is an "issue" row in inventory_stock_movements (from Inventory admins directly, or from a fulfilled request);
 * each return is a "return" row pointing back at it (issue_id). What is still out is the issue's quantity minus its returns, worked out
 * from the history every time, so it cannot drift. Each change of stock is ONE statement that also writes its movement.
 * An issue comes out of one branch's stock, and its returns go back to the same branch.
 */

type Actor = Pick<InventoryUser, "id" | "name">;
const audit = (actor: Actor, action: string, id: string, label: string, details: Record<string, unknown> = {}) =>
  writeAudit(actor, [{ action: `inventory.${action}`, targetType: "system", targetId: id, targetLabel: label, details }]);

export type IssueRow = {
  id: string; itemId: string; item: string; unit: string; branchName: string; quantity: number; returned: number; outstanding: number;
  issuedToUserId: string | null; issuedToName: string | null; departmentId: string | null; eventName: string | null; note: string | null;
  requestId: string | null; actorName: string; createdAt: Date; lastReturnAt: Date | null;
};
export type IssueFilter = "out" | "returned" | "all";

/** Every issue (Inventory admins), or only those made to one person. "out": something still to come back; "returned": all of it is back. */
export async function listIssues(f: { toUser?: string; filter?: IssueFilter; branchId?: string }): Promise<IssueRow[]> {
  const res = (await db.execute(sql`
    select m.id, m.item_id, i.name as item, i.unit, br.name as branch_name, -m.delta as quantity, coalesce(r.back, 0)::int as returned, (-m.delta - coalesce(r.back, 0))::int as outstanding,
      m.issued_to_user_id, m.issued_to_name, m.issued_to_department_id, m.event_name, m.reason as note, m.request_id, m.actor_name, m.created_at, r.last_at
    from inventory_stock_movements m
    join inventory_items i on i.id = m.item_id
    join branches br on br.id = m.branch_id
    left join (select issue_id, sum(delta)::int as back, max(created_at) as last_at from inventory_stock_movements where kind = 'return' group by issue_id) r on r.issue_id = m.id
    where m.kind = 'issue'
      ${f.toUser ? sql`and m.issued_to_user_id = ${f.toUser}` : sql``}
      ${f.branchId ? sql`and m.branch_id = ${f.branchId}` : sql``}
      ${f.filter === "out" ? sql`and -m.delta > coalesce(r.back, 0)` : f.filter === "returned" ? sql`and -m.delta <= coalesce(r.back, 0)` : sql``}
    order by (-m.delta > coalesce(r.back, 0)) desc, m.created_at desc
    limit 1000`)) as unknown as { rows: Record<string, unknown>[] };
  return res.rows.map((r) => ({
    id: String(r.id), itemId: String(r.item_id), item: String(r.item), unit: String(r.unit), branchName: String(r.branch_name), quantity: Number(r.quantity), returned: Number(r.returned), outstanding: Number(r.outstanding),
    issuedToUserId: (r.issued_to_user_id as string) ?? null, issuedToName: (r.issued_to_name as string) ?? null, departmentId: (r.issued_to_department_id as string) ?? null,
    eventName: (r.event_name as string) ?? null, note: (r.note as string) ?? null, requestId: (r.request_id as string) ?? null, actorName: String(r.actor_name),
    createdAt: new Date(r.created_at as string), lastReturnAt: r.last_at ? new Date(r.last_at as string) : null,
  }));
}

/** Issues an active item directly from one branch. The stock there is taken out only if there is enough, and the movement is written in the same statement. */
export async function issueItem(v: IssueInput, branch: { id: string; name: string }, actor: Actor) {
  let name = v.name;
  if (v.userId) {
    const person = (await listUsers()).find((u) => u.id === v.userId);
    if (!person) throw new InventoryError("That person is not an active user of the hub. Reload and try again.", 404);
    name = person.name;
  }
  const res = (await db.execute(sql`
    with stock as (
      update inventory_branch_stock b set quantity = b.quantity - ${v.quantity}
      from inventory_items i
      where i.id = b.item_id and b.item_id = ${v.itemId} and b.branch_id = ${branch.id} and i.active and b.quantity >= ${v.quantity}
      returning b.item_id as id, i.name, b.quantity
    ), total as (
      update inventory_items set quantity = quantity - ${v.quantity} where id in (select id from stock)
    ), movement as (
      insert into inventory_stock_movements (item_id, kind, delta, quantity_after, reason, issued_to_user_id, issued_to_name, issued_to_department_id, event_name, branch_id, actor_user_id, actor_name)
      select id, 'issue', ${-v.quantity}, quantity, ${v.note}, ${v.userId}, ${name}, ${v.departmentId}, ${v.eventName}, ${branch.id}, ${actor.id}, ${actor.name} from stock
      returning id
    )
    select (select id from movement) as id, (select name from stock) as item, (select quantity from stock) as after`)) as unknown as { rows: { id: string | null; item: string | null; after: number | null }[] };
  const row = res.rows[0];
  if (row?.id && row.item) {
    await audit(actor, "item_issued", row.id, row.item, { quantity: v.quantity, to: name, event: v.eventName, branch: branch.name, stockAfter: row.after });
    return { id: row.id };
  }
  const [it] = (await db.execute(sql`
    select i.name, i.active, b.quantity from inventory_items i left join inventory_branch_stock b on b.item_id = i.id and b.branch_id = ${branch.id}
    where i.id = ${v.itemId}`) as unknown as { rows: { name: string; active: boolean; quantity: number | null }[] }).rows;
  if (!it || !it.active) throw new InventoryError("That item is not available. Reload and try again.", 404);
  if (it.quantity == null) throw new InventoryError(`${branch.name} does not keep this item. Nothing was changed.`, 409);
  throw new InventoryError(`Not enough in stock at ${branch.name}: ${v.quantity} asked for, ${it.quantity} available. Nothing was changed.`, 409);
}

/**
 * Takes back some or all of what is still out on one issue. The issue row is locked for the statement, the quantity must not exceed
 * what is still out, and the stock at the issue's branch goes back up with the return movement written in the same statement.
 */
export async function returnIssue(issueId: string, quantity: number, note: string | null, actor: Actor) {
  const res = (await db.execute(sql`
    with issue as (
      select id, item_id, branch_id, -delta as qty, issued_to_user_id, issued_to_name, issued_to_department_id, event_name
      from inventory_stock_movements where id = ${issueId} and kind = 'issue' for update
    ), back as (
      select coalesce(sum(delta), 0)::int as back from inventory_stock_movements where issue_id = ${issueId} and kind = 'return'
    ), stock as (
      insert into inventory_branch_stock (item_id, branch_id, quantity)
      select issue.item_id, issue.branch_id, ${quantity} from issue, back where ${quantity} <= issue.qty - back.back
      on conflict (item_id, branch_id) do update set quantity = inventory_branch_stock.quantity + excluded.quantity
      returning item_id as id, quantity
    ), total as (
      update inventory_items i set quantity = i.quantity + ${quantity} from stock where i.id = stock.id returning i.name
    ), movement as (
      insert into inventory_stock_movements (item_id, kind, delta, quantity_after, reason, issued_to_user_id, issued_to_name, issued_to_department_id, event_name, issue_id, branch_id, actor_user_id, actor_name)
      select stock.id, 'return', ${quantity}, stock.quantity, ${note}, issue.issued_to_user_id, issue.issued_to_name, issue.issued_to_department_id, issue.event_name, ${issueId}, issue.branch_id, ${actor.id}, ${actor.name}
      from stock, issue
      returning id
    )
    select (select id from movement) as id, (select name from total) as item, (select qty from issue)::int as issued, (select back from back) as back,
      (select issued_to_name from issue) as to_name`)) as unknown as { rows: { id: string | null; item: string | null; issued: number | null; back: number; to_name: string | null }[] };
  const row = res.rows[0];
  if (row?.issued == null) throw new InventoryError("That issue no longer exists. Reload and try again.", 404);
  if (!row.id || !row.item) {
    const out = row.issued - row.back;
    throw new InventoryError(out <= 0 ? "Everything on this issue has already come back." : `Only ${out} still out on this issue. Nothing was changed.`, 409);
  }
  await audit(actor, "item_returned", row.id, row.item, { quantity, from: row.to_name, issueId });
}
