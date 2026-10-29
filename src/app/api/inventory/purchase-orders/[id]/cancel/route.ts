import { idParam, ok, route } from "@/lib/inventory/guard";
import { cancelPurchaseOrder } from "@/lib/inventory/purchase-orders";

export const dynamic = "force-dynamic";

/** Cancels a draft or sent order. Inventory admin only. */
export const POST = route<{ id: string }>({ roles: ["inventory_admin"] }, async ({ user, params }) => {
  await cancelPurchaseOrder(idParam(params.id), user);
  return ok();
});
