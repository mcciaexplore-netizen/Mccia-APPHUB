import { idParam, ok, readJson, route } from "@/lib/inventory/guard";
import { vendorInput } from "@/lib/inventory/validation";
import { deleteVendor, updateVendor } from "@/lib/inventory/vendors";

export const dynamic = "force-dynamic";

/** Saves a vendor, including turning it inactive or active again. Inventory admin only. */
export const PATCH = route<{ id: string }>({ roles: ["inventory_admin"] }, async ({ req, user, params }) => {
  await updateVendor(idParam(params.id), await readJson(req, vendorInput), user);
  return ok();
});

/** Deletes a vendor; purchase orders keep its name. Inventory admin only. */
export const DELETE = route<{ id: string }>({ roles: ["inventory_admin"] }, async ({ user, params }) => {
  await deleteVendor(idParam(params.id), user);
  return ok();
});
