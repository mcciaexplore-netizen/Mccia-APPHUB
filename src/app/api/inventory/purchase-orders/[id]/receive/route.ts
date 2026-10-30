import { branchFor } from "@/lib/inventory/branches";
import { idParam, ok, readJson, route } from "@/lib/inventory/guard";
import { receivePurchaseOrder } from "@/lib/inventory/purchase-orders";
import { receiveInput } from "@/lib/inventory/validation";

export const dynamic = "force-dynamic";

/** Records goods arriving on a sent order at a branch (the chosen one, or the admin's own): its stock goes up and inward movements are written. Inventory admin only. */
export const POST = route<{ id: string }>({ roles: ["inventory_admin"] }, async ({ req, user, params }) => {
  const v = await readJson(req, receiveInput);
  return ok(await receivePurchaseOrder(idParam(params.id), v, await branchFor(user, v.branchId), user));
});
