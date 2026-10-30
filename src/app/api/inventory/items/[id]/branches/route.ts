import { branchFor } from "@/lib/inventory/branches";
import { addItemToBranch } from "@/lib/inventory/catalog";
import { MANAGES_ITEMS } from "@/lib/inventory/inventory.manifest";
import { idParam, ok, readJson, route } from "@/lib/inventory/guard";
import { itemBranchInput } from "@/lib/inventory/validation";

export const dynamic = "force-dynamic";

/** Starts keeping an existing item at another branch, with its opening stock and minimum there. Staff and Inventory admins. */
export const POST = route<{ id: string }>({ roles: [...MANAGES_ITEMS] }, async ({ req, user, params }) => {
  const v = await readJson(req, itemBranchInput);
  await addItemToBranch(idParam(params.id), v, await branchFor(user, v.branchId), user);
  return ok({}, 201);
});
