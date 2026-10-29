import { ok, readJson, route } from "@/lib/inventory/guard";
import { vendorInput } from "@/lib/inventory/validation";
import { createVendor } from "@/lib/inventory/vendors";

export const dynamic = "force-dynamic";

/** Adds a vendor. Inventory admin only. */
export const POST = route({ roles: ["inventory_admin"] }, async ({ req, user }) => ok({ vendor: await createVendor(await readJson(req, vendorInput), user) }, 201));
