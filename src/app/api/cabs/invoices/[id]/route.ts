import { idParam, ok, route } from "@/lib/cabs/guard";
import { deleteDraftInvoice } from "@/lib/cabs/invoices";

export const dynamic = "force-dynamic";

/** Delete a draft invoice; its rides can be invoiced again (Cabs admins). */
export const DELETE = route<{ id: string }>({ roles: ["cab_admin"] }, async ({ user, params }) => {
  await deleteDraftInvoice(idParam(params.id), user);
  return ok();
});
