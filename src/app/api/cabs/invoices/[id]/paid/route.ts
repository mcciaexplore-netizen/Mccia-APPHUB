import { idParam, ok, route } from "@/lib/cabs/guard";
import { markInvoice } from "@/lib/cabs/invoices";

export const dynamic = "force-dynamic";

/** Mark an invoice paid (sent → paid) (Cabs admins). */
export const POST = route<{ id: string }>({ roles: ["cab_admin"] }, async ({ user, params }) => {
  await markInvoice(idParam(params.id), "paid", user);
  return ok();
});
