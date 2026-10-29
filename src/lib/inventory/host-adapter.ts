import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { inventoryUserRoles } from "@/db/inventory-schema";
import { adminUnlocked, getCurrentUser as hostCurrentUser } from "@/lib/permissions";
import { ALL_ROLES, type InventoryRole } from "./inventory.manifest";

/**
 * The only file in the Inventory module that knows about the host: its session and its user table. Everything else asks here, the same
 * way the Approval System does (src/lib/approvals/host-adapter.ts).
 */

export type { InventoryRole };
export type InventoryUser = { id: string; name: string; email: string; roles: InventoryRole[] };
export type Access = { status: "anonymous" } | { status: "ok"; user: InventoryUser };

const isRole = (r: string): r is InventoryRole => (ALL_ROLES as readonly string[]).includes(r);

/** requester: everyone. inventory_staff and inventory_admin: granted in inventory_user_roles. The Support Admin is always an inventory_admin. */
async function rolesFor(userId: string, hubRole: string): Promise<InventoryRole[]> {
  const granted = await db.select({ role: inventoryUserRoles.role }).from(inventoryUserRoles).where(eq(inventoryUserRoles.userId, userId));
  const roles = new Set<InventoryRole>(["requester"]);
  for (const g of granted) if (isRole(g.role)) roles.add(g.role);
  if (hubRole === "head_admin") roles.add("inventory_admin");
  return [...roles];
}

/** Who is asking. Anyone signed in to the hub may open Inventory as a requester; what else they can do comes from their roles. */
export const resolveAccess = cache(async (): Promise<Access> => {
  const host = await hostCurrentUser();
  if (!host) return { status: "anonymous" };
  return { status: "ok", user: { id: host.id, name: host.name, email: host.email, roles: await rolesFor(host.id, host.role) } };
});

/** Whether the person is still on the temporary password they were emailed: they must choose their own before using the module. */
export const needsOwnPassword = async () => !!(await hostCurrentUser())?.mustChangePassword;

/** Whether the person has unlocked Administrator with their password recently (asked again before admin changes, as in Approvals). */
export const administratorUnlocked = async () => {
  const host = await hostCurrentUser();
  return !!host && (await adminUnlocked(host));
};

export const hasRole = (user: Pick<InventoryUser, "roles"> | null | undefined, role: InventoryRole) => !!user && user.roles.includes(role);
export const hasAnyRole = (user: Pick<InventoryUser, "roles"> | null | undefined, roles: readonly InventoryRole[]) => !!user && roles.some((r) => user.roles.includes(r));
