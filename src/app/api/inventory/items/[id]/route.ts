import { deleteItem, updateItem } from "@/lib/inventory/catalog";
import { idParam, ok, readJson, route } from "@/lib/inventory/guard";
import { itemInput } from "@/lib/inventory/validation";

export const dynamic = "force-dynamic";

/** Saves an item; a changed quantity is written to the stock history as a recount. Inventory admin only. */
export const PATCH = route<{ id: string }>({ roles: ["inventory_admin"] }, async ({ req, user, params }) => {
  await updateItem(idParam(params.id), await readJson(req, itemInput), user);
  return ok();
});

/** Deletes an item with its stock history, requests and purchase-order lines (see deleteItem). Inventory admin only. */
export const DELETE = route<{ id: string }>({ roles: ["inventory_admin"] }, async ({ user, params }) => ok(await deleteItem(idParam(params.id), user)));
