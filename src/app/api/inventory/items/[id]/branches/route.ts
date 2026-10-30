import { branchFor } from "@/lib/inventory/branches";
import { addItemToBranch } from "@/lib/inventory/catalog";
import { idParam, ok, readJson, route } from "@/lib/inventory/guard";
import { itemBranchInput } from "@/lib/inventory/validation";

export const dynamic = "force-dynamic";

/** Starts keeping an existing item at another branch, with its opening stock and minimum there. Inventory admin only. */
export const POST = route<{ id: string }>({ roles: ["inventory_admin"] }, async ({ req, user, params }) => {
  const v = await readJson(req, itemBranchInput);
  await addItemToBranch(idParam(params.id), v, await branchFor(user, v.branchId), user);
  return ok({}, 201);
});
