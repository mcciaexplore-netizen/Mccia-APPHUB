import { ok, readJson, route } from "@/lib/inventory/guard";
import { transferStock } from "@/lib/inventory/transfers";
import { transferInput } from "@/lib/inventory/validation";

export const dynamic = "force-dynamic";

/** Moves stock of one item from one branch to another (a movement at each). Inventory admin only. */
export const POST = route({ roles: ["inventory_admin"] }, async ({ req, user }) => ok({ transfer: await transferStock(await readJson(req, transferInput), user) }, 201));
