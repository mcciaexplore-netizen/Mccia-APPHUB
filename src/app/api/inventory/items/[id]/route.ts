import { branchFor } from "@/lib/inventory/branches";
import { deleteItem, updateItem } from "@/lib/inventory/catalog";
import { MANAGES_ITEMS } from "@/lib/inventory/inventory.manifest";
import { idParam, ok, readJson, route } from "@/lib/inventory/guard";
import { itemInput } from "@/lib/inventory/validation";

export const dynamic = "force-dynamic";

/** Saves an item, with its quantity and minimum at one branch; a changed quantity is written to the stock history as a recount there. Staff and Inventory admins. */
export const PATCH = route<{ id: string }>({ roles: [...MANAGES_ITEMS] }, async ({ req, user, params }) => {
  const v = await readJson(req, itemInput);
  await updateItem(idParam(params.id), v, await branchFor(user, v.branchId, { allowInactive: true }), user);
  return ok();
});

/** Deletes an item with its stock history, requests and purchase-order lines (see deleteItem). Staff and Inventory admins. */
export const DELETE = route<{ id: string }>({ roles: [...MANAGES_ITEMS] }, async ({ user, params }) => ok(await deleteItem(idParam(params.id), user)));
