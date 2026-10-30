import { branchFor } from "@/lib/inventory/branches";
import { createItem } from "@/lib/inventory/catalog";
import { ok, readJson, route } from "@/lib/inventory/guard";
import { itemInput } from "@/lib/inventory/validation";

export const dynamic = "force-dynamic";

/** A new item, kept at the chosen branch (or the admin's own), with any starting quantity written to its stock history as "Opening stock". Inventory admin only. */
export const POST = route({ roles: ["inventory_admin"] }, async ({ req, user }) => {
  const v = await readJson(req, itemInput);
  return ok({ item: await createItem(v, await branchFor(user, v.branchId), user) }, 201);
});
