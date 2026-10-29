import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { inventoryUserRoles } from "@/db/inventory-schema";
import { writeAudit, type AuditEntry } from "@/lib/audit";
import { InventoryError } from "./errors";
import { listUsers, type InventoryUser } from "./host-adapter";
import { GRANTED_ROLES, type GrantedRole } from "./inventory.manifest";

/**
 * Who holds which Inventory role, and changing it (Settings). Each person holds at most one granted role: Inventory admin or Inventory
 * staff. The Support Admin is always an Inventory admin and is not changed here. Every grant and removal is written to the hub's audit
 * log (Administrator → Activity Log) as inventory.role_granted / inventory.role_revoked. Same shape as the Approval System's roles.
 */

export type RoleRow = { userId: string; name: string; email: string; supportAdmin: boolean; role: GrantedRole | null };

export async function listRoleRows(): Promise<RoleRow[]> {
  const [people, granted] = await Promise.all([listUsers(), db.select({ userId: inventoryUserRoles.userId, role: inventoryUserRoles.role }).from(inventoryUserRoles)]);
  const roleOf = (id: string): GrantedRole | null => {
    const mine = granted.filter((g) => g.userId === id).map((g) => g.role);
    return mine.includes("inventory_admin") ? "inventory_admin" : mine.includes("inventory_staff") ? "inventory_staff" : null;
  };
  return people.map((u) => ({ userId: u.id, name: u.name, email: u.email, supportAdmin: u.hubRole === "head_admin", role: u.hubRole === "head_admin" ? "inventory_admin" : roleOf(u.id) }));
}

const LABEL: Record<GrantedRole, string> = { inventory_admin: "Inventory admin", inventory_staff: "Inventory staff" };

/**
 * Makes `role` the person's only granted Inventory role (null: none), in ONE statement: the other role is removed and the new one added
 * together, so a person is never left holding both. Nothing happens, and nothing is logged, when they already have exactly that.
 */
export async function setInventoryRole(userId: string, role: GrantedRole | null, actor: Pick<InventoryUser, "id" | "name">): Promise<{ added: GrantedRole[]; removed: GrantedRole[] }> {
  const person = (await listUsers()).find((u) => u.id === userId);
  if (!person) throw new InventoryError("That person is not an active user of the hub. Reload and try again.", 404);
  if (person.hubRole === "head_admin") throw new InventoryError("The Support Admin is always an Inventory admin; that can't be changed here.", 409);
  if (userId === actor.id && role !== "inventory_admin") {
    const [mine] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(inventoryUserRoles)
      .where(sql`${inventoryUserRoles.userId} = ${userId} and ${inventoryUserRoles.role} = 'inventory_admin'`);
    if (mine.n > 0) throw new InventoryError("You can't remove your own admin role. Ask another Inventory admin to do it.", 409);
  }

  const res = (await db.execute(sql`
    with removed as (
      delete from inventory_user_roles
      where user_id = ${userId} and role in (${sql.join(GRANTED_ROLES.map((r) => sql`${r}`), sql`, `)}) and role is distinct from ${role}::text
      returning role
    ), added as (
      insert into inventory_user_roles (user_id, role, granted_by_id)
      select ${userId}, ${role}, ${actor.id} where ${role}::text is not null
      on conflict (user_id, role) do nothing
      returning role
    )
    select (select coalesce(array_agg(role), '{}') from removed) as removed, (select coalesce(array_agg(role), '{}') from added) as added`)) as unknown as {
    rows: { removed: GrantedRole[] | string; added: GrantedRole[] | string }[];
  };
  // node-postgres returns text[] as an array; read a literal "{a,b}" too, in case a driver hands it back as text.
  const list = (v: GrantedRole[] | string): GrantedRole[] => (Array.isArray(v) ? v : v.replace(/[{}]/g, "").split(",").filter(Boolean) as GrantedRole[]);
  const removed = list(res.rows[0].removed), added = list(res.rows[0].added);

  const entries: AuditEntry[] = [
    ...removed.map((r): AuditEntry => ({ action: "inventory.role_revoked", targetType: "user", targetId: userId, targetLabel: person.name, details: { role: r, label: LABEL[r], email: person.email } })),
    ...added.map((r): AuditEntry => ({ action: "inventory.role_granted", targetType: "user", targetId: userId, targetLabel: person.name, details: { role: r, label: LABEL[r], email: person.email } })),
  ];
  await writeAudit(actor, entries);
  return { added, removed };
}
