import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { approvalsEnabled } from "@/lib/approvals/flags";
import { formatDate, formatINR } from "@/lib/approvals/format";
import { approvalsOverview, type StatusCounts } from "@/lib/approvals/summary";
import { requireHeadAdmin } from "@/lib/permissions";

export const metadata = { title: "Approvals · MCCIA App Hub" };

const KIND: Record<string, string> = { hr: "HR request", expenditure_large: "Expenditure ₹10,000+", expenditure_small: "Expense below ₹10,000" };

function Tile({ label, n, href, warn }: { label: string; n: number; href: string; warn?: boolean }) {
  return (
    <Link href={href} className="glass glass-hover !rounded-md block p-4 text-center">
      <span className={`big-number ${warn && n > 0 ? "!text-brand-red" : ""}`}>{n}</span>
      <p className="label-xs mt-2">{label}</p>
    </Link>
  );
}

function Section({ title, intro, rows }: { title: string; intro: string; rows: { name: string; c: StatusCounts; base: string }[] }) {
  return (
    <section className="space-y-3" aria-label={title}>
      <div><h2 className="text-xl">{title}</h2><p className="text-sm text-muted">{intro}</p></div>
      {rows.map((r) => (
        <div key={r.name} className="space-y-2">
          {rows.length > 1 && <h3 className="text-sm font-bold">{r.name}</h3>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Pending" n={r.c.pending} href={`${r.base}/pending`} warn />
            <Tile label="Approved" n={r.c.approved} href={`${r.base}/approved`} />
            <Tile label="Rejected" n={r.c.rejected} href={`${r.base}/rejected`} />
            <Tile label="Returned for corrections" n={r.c.returned} href={`${r.base}/all?status=returned`} />
          </div>
        </div>
      ))}
    </section>
  );
}

/** HR and Expenditure approvals side by side, with real counts that open the filtered lists. For the Support Admin and the Super Admin only. */
export default async function Page() {
  await requireHeadAdmin();
  if (!approvalsEnabled()) return <p className="text-sm text-muted">The Approval System is switched off.</p>;
  const o = await approvalsOverview();
  return (
    <div className="space-y-8">
      <Section title="HR approvals" intro="HR requests: reviewed by HR, then the Super Admin." rows={[{ name: "HR requests", c: o.hr, base: "/approvals/hr" }]} />
      <Section title="Expenditure approvals" intro="Expenditure: the first approver, then the Super Admin for ₹10,000 and above." rows={[
        { name: "₹10,000 and above", c: o.large, base: "/approvals/expenditures" },
        { name: "Below ₹10,000", c: o.small, base: "/approvals/expenses" },
      ]} />
      <section className="glass !rounded-md space-y-3 p-5 sm:p-6" aria-label="Waiting now">
        <h2 className="flex items-center gap-2 text-xl"><ClipboardCheck size={18} /> Waiting for a decision now</h2>
        {o.waiting.length === 0 ? <p className="text-sm text-muted">Nothing is waiting.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Request</th><th>Kind</th><th>Requester</th><th>Amount</th><th>Submitted</th><th>Waiting for</th></tr></thead>
              <tbody>
                {o.waiting.map((w) => (
                  <tr key={w.id}>
                    <td><Link href={`/approvals/requests/${w.id}?app=${w.kind === "expenditure_small" ? "exp" : "hr"}`} className="font-bold text-primary hover:underline">{w.requestNo ?? "Request"}</Link></td>
                    <td>{KIND[w.kind]}</td><td>{w.requester}</td><td>{w.amountPaise == null ? "—" : formatINR(w.amountPaise, { symbol: true })}</td>
                    <td>{formatDate(w.requestedAt)}</td><td>{w.waitingFor ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
