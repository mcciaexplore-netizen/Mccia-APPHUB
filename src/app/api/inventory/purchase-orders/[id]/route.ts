import { idParam, ok, readJson, route } from "@/lib/inventory/guard";
import { updateDraft } from "@/lib/inventory/purchase-orders";
import { poInput } from "@/lib/inventory/validation";

export const dynamic = "force-dynamic";

/** Replaces a draft's vendor, notes and lines. Only while it is a draft. Inventory admin only. */
export const PATCH = route<{ id: string }>({ roles: ["inventory_admin"] }, async ({ req, user, params }) => {
  await updateDraft(idParam(params.id), await readJson(req, poInput), user);
  return ok();
});
