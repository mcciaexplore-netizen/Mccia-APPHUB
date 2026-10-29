import { ok, readJson, route } from "@/lib/inventory/guard";
import { createPurchaseOrder } from "@/lib/inventory/purchase-orders";
import { poInput } from "@/lib/inventory/validation";

export const dynamic = "force-dynamic";

/** A new draft purchase order with its lines and the next number of the financial year. Inventory admin only. */
export const POST = route({ roles: ["inventory_admin"] }, async ({ req, user }) => ok({ purchaseOrder: await createPurchaseOrder(await readJson(req, poInput), user) }, 201));
