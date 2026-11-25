import { deleteAmc, updateAmc } from "@/lib/inventory/amc";
import { idParam, ok, readJson, route } from "@/lib/inventory/guard";
import { amcInput } from "@/lib/inventory/validation";

export const dynamic = "force-dynamic";

/** Saves a contract. Inventory admin only. */
export const PATCH = route<{ id: string }>({ roles: ["inventory_admin"] }, async ({ req, user, params }) => {
  await updateAmc(idParam(params.id), await readJson(req, amcInput), user);
  return ok();
});

/** Deletes a contract. Inventory admin only. */
export const DELETE = route<{ id: string }>({ roles: ["inventory_admin"] }, async ({ user, params }) => {
  await deleteAmc(idParam(params.id), user);
  return ok();
});
