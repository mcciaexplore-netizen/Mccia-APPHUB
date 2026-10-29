import { idParam, ok, route } from "@/lib/inventory/guard";
import { sendPurchaseOrder } from "@/lib/inventory/purchase-orders";

export const dynamic = "force-dynamic";

/** Draft → sent (records when). Inventory admin only. */
export const POST = route<{ id: string }>({ roles: ["inventory_admin"] }, async ({ user, params }) => {
  await sendPurchaseOrder(idParam(params.id), user);
  return ok();
});
