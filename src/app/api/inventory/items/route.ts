import { createItem } from "@/lib/inventory/catalog";
import { ok, readJson, route } from "@/lib/inventory/guard";
import { itemInput } from "@/lib/inventory/validation";

export const dynamic = "force-dynamic";

/** A new item, with any starting quantity written to the stock history as "Opening stock". Inventory admin only. */
export const POST = route({ roles: ["inventory_admin"] }, async ({ req, user }) => ok({ item: await createItem(await readJson(req, itemInput), user) }, 201));
