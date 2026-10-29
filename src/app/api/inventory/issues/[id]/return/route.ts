import { idParam, ok, readJson, route } from "@/lib/inventory/guard";
import { returnIssue } from "@/lib/inventory/issues";
import { returnInput } from "@/lib/inventory/validation";

export const dynamic = "force-dynamic";

/** Inventory admins take back some or all of what is still out on one issue; the stock goes back up. */
export const POST = route<{ id: string }>({ roles: ["inventory_admin"] }, async ({ req, user, params }) => {
  const v = await readJson(req, returnInput);
  await returnIssue(idParam(params.id), v.quantity, v.note, user);
  return ok();
});
