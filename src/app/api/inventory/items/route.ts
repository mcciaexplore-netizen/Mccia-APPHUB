import { branchFor } from "@/lib/inventory/branches";
import { createItem } from "@/lib/inventory/catalog";
import { MANAGES_ITEMS } from "@/lib/inventory/inventory.manifest";
import { ok, readJson, route } from "@/lib/inventory/guard";
import { itemInput } from "@/lib/inventory/validation";

export const dynamic = "force-dynamic";

/** A new item, kept at the chosen branch (or the admin's own), with any starting quantity written to its stock history as "Opening stock". Staff and Inventory admins. */
export const POST = route({ roles: [...MANAGES_ITEMS] }, async ({ req, user }) => {
  const v = await readJson(req, itemInput);
  return ok({ item: await createItem(v, await branchFor(user, v.branchId), user) }, 201);
});
