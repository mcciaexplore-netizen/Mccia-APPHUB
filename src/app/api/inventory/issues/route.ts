import { ok, readJson, route } from "@/lib/inventory/guard";
import { issueItem } from "@/lib/inventory/issues";
import { issueInput } from "@/lib/inventory/validation";

export const dynamic = "force-dynamic";

/** Store staff issue an item directly to a person (a hub user or a name), with an optional department and event. */
export const POST = route({ roles: ["inventory_staff", "inventory_admin"] }, async ({ req, user }) => ok({ issue: await issueItem(await readJson(req, issueInput), user) }, 201));
