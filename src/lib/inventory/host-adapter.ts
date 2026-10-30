import "server-only";
import { cache } from "react";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { departments, users } from "@/db/schema";
import { getCurrentUser as hostCurrentUser } from "@/lib/permissions";
import { hasArea } from "@/lib/rbac";
import { INVENTORY_URL_PATTERN, inventoryRoleFor, type InventoryRole } from "./inventory.manifest";

/**
 * The only file in the Inventory module that knows about the host: its session, its users and its application access. Everything else
 * asks here, the same way the Approval System does (src/lib/approvals/host-adapter.ts).
 */

export type { InventoryRole };
/** `hubRole` is the person's role in the hub. Their Inventory role: see inventoryRoleFor. */
export type InventoryUser = { id: string; name: string; email: string; roles: InventoryRole[]; hubRole: string };
export type Access = { status: "anonymous" } | { status: "no_access" } | { status: "ok"; user: InventoryUser };

/**
 * For the active Inventory application (URL /inventory, in an active category): whether this person has been given it (the hub's own rule
 * for applications), and whether they are one of its App Admins or App Staff. One query.
 */
async function inventoryStanding(userId: string): Promise<{ access: boolean; admin: boolean; staff: boolean }> {
  const res = (await db.execute(sql`
    select coalesce(bool_or(ua.user_id is not null), false) as access, coalesce(bool_or(ad.user_id is not null), false) as admin,
      coalesce(bool_or(st.user_id is not null), false) as staff
    from apps a
    join departments d on d.id = a.department_id
    left join user_app_access ua on ua.app_id = a.id and ua.user_id = ${userId}
    left join app_admins ad on ad.app_id = a.id and ad.user_id = ${userId}
    left join app_staff st on st.app_id = a.id and st.user_id = ${userId}
    where a.is_active and d.is_active and a.url ~ ${INVENTORY_URL_PATTERN}`)) as unknown as { rows: { access: boolean; admin: boolean; staff: boolean }[] };
  return { access: !!res.rows[0]?.access, admin: !!res.rows[0]?.admin, staff: !!res.rows[0]?.staff };
}

/** Who is asking, whether they may open Inventory (the Support Admin always), and their role in it (see inventoryRoleFor). */
export const resolveAccess = cache(async (): Promise<Access> => {
  const host = await hostCurrentUser();
  if (!host) return { status: "anonymous" };
  const standing = host.role === "head_admin" ? { access: true, admin: true, staff: false } : await inventoryStanding(host.id);
  if (!standing.access) return { status: "no_access" };
  const role = inventoryRoleFor(host.role, standing.admin, standing.staff);
  const roles: InventoryRole[] = role === "requester" ? ["requester"] : ["requester", role];
  return { status: "ok", user: { id: host.id, name: host.name, email: host.email, roles, hubRole: host.role } };
});

/**
 * Whether the person may open Administrator → Applications, where the Inventory application's App Admins and App Staff are set (who is
 * Admin and Staff here). Only then does the dashboard offer "Manage users".
 */
export const canManagePeople = async () => {
  const host = await hostCurrentUser();
  return !!host && hasArea(host, "apps");
};

/** Whether the person is still on the temporary password they were emailed: they must choose their own before using the module. */
export const needsOwnPassword = async () => !!(await hostCurrentUser())?.mustChangePassword;

export const hasRole = (user: Pick<InventoryUser, "roles"> | null | undefined, role: InventoryRole) => !!user && user.roles.includes(role);
export const hasAnyRole = (user: Pick<InventoryUser, "roles"> | null | undefined, roles: readonly InventoryRole[]) => !!user && roles.some((r) => user.roles.includes(r));

export type DirectoryUser = { id: string; name: string; email: string; hubRole: string };

/** Everyone who can sign in to the hub (active and approved), for "issued to". There is no second user table. */
export async function listUsers(): Promise<DirectoryUser[]> {
  return db
    .select({ id: users.id, name: users.name, email: users.email, hubRole: users.role })
    .from(users)
    .where(and(eq(users.isActive, true), eq(users.status, "approved")))
    .orderBy(asc(users.name));
}

/** The organisation's departments (not the hub's application categories), for "issued to department". */
export async function listDepartments(): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: departments.id, name: departments.name })
    .from(departments)
    .where(and(eq(departments.kind, "organisation"), eq(departments.isActive, true)))
    .orderBy(asc(departments.sortOrder), asc(departments.name));
}
