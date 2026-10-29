import { idParam, ok, readJson, route } from "@/lib/inventory/guard";
import { vendorInput } from "@/lib/inventory/validation";
import { deleteVendor, updateVendor } from "@/lib/inventory/vendors";

export const dynamic = "force-dynamic";

/** Saves a vendor, including turning it inactive or active again. Inventory admin only. */
export const PATCH = route<{ id: string }>({ roles: ["inventory_admin"] }, async ({ req, user, params }) => {
  await updateVendor(idParam(params.id), await readJson(req, vendorInput), user);
  return ok();
});

/** Only a vendor nothing refers to can be deleted; one on purchase orders or stock records is deactivated instead. */
export const DELETE = route<{ id: string }>({ roles: ["inventory_admin"] }, async ({ user, params }) => {
  await deleteVendor(idParam(params.id), user);
  return ok();
});
