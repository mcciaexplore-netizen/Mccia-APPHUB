import "server-only";
import { cache } from "react";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { apps, departments, userAppAccess, users } from "@/db/schema";
import { getCurrentUser as hostCurrentUser } from "@/lib/permissions";
import { INVENTORY_URL_PATTERN, inventoryRoleFor, type InventoryRole } from "./inventory.manifest";

/**
 * The only file in the Inventory module that knows about the host: its session, its users and its application access. Everything else
 * asks here, the same way the Approval System does (src/lib/approvals/host-adapter.ts).
 */

export type { InventoryRole };
/** `hubRole` is the person's role in the hub; their Inventory role comes from it (see inventoryRoleFor). */
export type InventoryUser = { id: string; name: string; email: string; roles: InventoryRole[]; hubRole: string };
export type Access = { status: "anonymous" } | { status: "no_access" } | { status: "ok"; user: InventoryUser };

/**
 * Whether this person may open Inventory, by the hub's own rule for applications: the Support Admin always; anyone else only if they have
 * been given an active Inventory application (URL /inventory) in an active category. One query.
 */
async function hasInventoryAccess(userId: string, hubRole: string): Promise<boolean> {
  if (hubRole === "head_admin") return true;
  const [row] = await db
    .select({ id: apps.id })
    .from(apps)
    .innerJoin(departments, eq(departments.id, apps.departmentId))
    .innerJoin(userAppAccess, and(eq(userAppAccess.appId, apps.id), eq(userAppAccess.userId, userId)))
    .where(and(eq(apps.isActive, true), eq(departments.isActive, true), sql`${apps.url} ~ ${INVENTORY_URL_PATTERN}`))
    .limit(1);
  return !!row;
}

/** Who is asking, whether they may open Inventory, and their role in it (from their hub role). */
export const resolveAccess = cache(async (): Promise<Access> => {
  const host = await hostCurrentUser();
  if (!host) return { status: "anonymous" };
  if (!(await hasInventoryAccess(host.id, host.role))) return { status: "no_access" };
  const role = inventoryRoleFor(host.role);
  const roles: InventoryRole[] = role === "inventory_admin" ? ["requester", "inventory_admin"] : ["requester"];
  return { status: "ok", user: { id: host.id, name: host.name, email: host.email, roles, hubRole: host.role } };
});

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
