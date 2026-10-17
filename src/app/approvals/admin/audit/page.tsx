import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { PageHeader } from "@/components/approvals/PageHeader";
import { formatDate, formatDateTime, formatINR } from "@/lib/approvals/format";
import { requirePage } from "@/lib/approvals/guard";
import { listAudit } from "@/lib/approvals/roles";
import { approvalsOverview } from "@/lib/approvals/admin-overview";

export const metadata = { title: "Audit Log · MCCIA Approvals" };

const KIND: Record<string, string> = { hr: "HR request", expenditure_large: "Expenditure ₹10,000+", expenditure_small: "Expense below ₹10,000" };

export default async function Page() {
  await requirePage("approvals_admin");
  const [rows, overview] = await Promise.all([listAudit(200), approvalsOverview()]);
  const waiting = overview.waiting;
  return (
    <>
      <section className="glass !rounded-md mb-8 space-y-3 p-5 sm:p-6" aria-label="Currently waiting for a decision">
        <h2 className="flex items-center gap-2 text-xl"><ClipboardCheck size={18} /> Currently waiting for a decision</h2>
        {waiting.length === 0 ? <p className="text-sm text-muted">Nothing is waiting.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Request</th><th>Kind</th><th>Requester</th><th>Amount</th><th>Submitted</th><th>Waiting for</th></tr></thead>
              <tbody>
                {waiting.map((w) => (
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
      <PageHeader title="Audit Log" intro="Every change an admin makes to categories, branches, roles and settings. The latest 200 are shown. What happened to each request is on its own timeline." />
      <div className="table-wrap">
        <table>
          <thead><tr><th className="w-48">When</th><th className="w-48">Who</th><th>What</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={3} className="py-8 text-center text-sm text-subtle">No changes recorded yet.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap tabular-nums text-muted">{formatDateTime(r.createdAt)}</td>
                <td>{r.actorName}</td>
                <td>{r.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
