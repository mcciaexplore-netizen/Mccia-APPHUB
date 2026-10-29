import { ok, readJson, route } from "@/lib/inventory/guard";
import { listRoleRows, setInventoryRole } from "@/lib/inventory/roles";
import { roleInput } from "@/lib/inventory/validation";

export const dynamic = "force-dynamic";

/** Everyone who can sign in to the hub, with their Inventory role. Inventory admins and the hub's Super Admin and Support Admin. */
export const GET = route({ manageRoles: true }, async () => ok({ items: await listRoleRows() }));

/** Sets one person's Inventory role: Admin, Staff or none. Nobody may remove their own admin role. */
export const PUT = route({ manageRoles: true }, async ({ req, user }) => {
  const { userId, role } = await readJson(req, roleInput);
  return ok(await setInventoryRole(userId, role, user));
});
