import { idParam, ok, route } from "@/lib/cabs/guard";
import { markInvoice } from "@/lib/cabs/invoices";

export const dynamic = "force-dynamic";

/** Mark an invoice sent (draft → sent) (Cabs admins). */
export const POST = route<{ id: string }>({ roles: ["cab_admin"] }, async ({ user, params }) => {
  await markInvoice(idParam(params.id), "sent", user);
  return ok();
});
