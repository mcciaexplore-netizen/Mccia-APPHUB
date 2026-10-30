import { branchFor } from "@/lib/inventory/branches";
import { ok, readJson, route } from "@/lib/inventory/guard";
import { issueItem } from "@/lib/inventory/issues";
import { issueInput } from "@/lib/inventory/validation";

export const dynamic = "force-dynamic";

/** Inventory admins issue an item directly from a branch (the chosen one, or their own) to a person (a hub user or a name), with an optional department and event. */
export const POST = route({ roles: ["inventory_admin"] }, async ({ req, user }) => {
  const v = await readJson(req, issueInput);
  return ok({ issue: await issueItem(v, await branchFor(user, v.branchId), user) }, 201);
});
