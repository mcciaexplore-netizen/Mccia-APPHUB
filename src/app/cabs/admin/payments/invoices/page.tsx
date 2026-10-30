import { InvoicesView } from "@/components/cabs/InvoicesView";
import { requireAdminPage } from "@/lib/cabs/guard";
import { listInvoices } from "@/lib/cabs/invoices";
import { rideBranches } from "@/lib/cabs/payments";
import { istToday } from "@/lib/cabs/validation";

export const metadata = { title: "Invoices · Cabs Admin · MCCIA App Hub" };

/** Invoices per branch and period: create, mark sent, mark paid. */
export default async function InvoicesPage() {
  await requireAdminPage();
  const [invoices, branches] = await Promise.all([listInvoices(), rideBranches()]);
  const today = istToday();
  return (
    <div className="page-enter space-y-5">
      <div><h1 className="text-2xl">Invoices</h1><p className="text-sm text-muted">One per branch and period, for its costed rides. A ride is only ever on one invoice.</p></div>
      <InvoicesView today={today} branches={branches} invoices={invoices.map((i) => ({ ...i, createdAt: i.createdAt.toISOString(), paidAt: i.paidAt ? i.paidAt.toISOString() : null }))} />
    </div>
  );
}
