import { idParam, ok, readJson, route } from "@/lib/inventory/guard";
import { receivePurchaseOrder } from "@/lib/inventory/purchase-orders";
import { receiveInput } from "@/lib/inventory/validation";

export const dynamic = "force-dynamic";

/** Records goods arriving on a sent order: stock goes up and inward movements are written. Inventory admin only. */
export const POST = route<{ id: string }>({ roles: ["inventory_admin"] }, async ({ req, user, params }) =>
  ok(await receivePurchaseOrder(idParam(params.id), await readJson(req, receiveInput), user)));
