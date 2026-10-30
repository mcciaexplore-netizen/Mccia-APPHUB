import { ok, readJson, route } from "@/lib/cabs/guard";
import { createInvoice } from "@/lib/cabs/invoices";
import { invoiceInput } from "@/lib/cabs/validation";

export const dynamic = "force-dynamic";

/** Create an invoice for a branch and period: it claims that branch's costed, completed rides not yet invoiced (Cabs admins). */
export const POST = route({ roles: ["cab_admin"] }, async ({ req, user }) => ok(await createInvoice(await readJson(req, invoiceInput), user), 201));
