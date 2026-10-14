import { PageHeader } from "@/components/approvals/PageHeader";
import { RangeForm, readRange } from "@/components/approvals/RangeForm";
import { formatINR } from "@/lib/approvals/format";
import { requirePage } from "@/lib/approvals/guard";
import { hrReport } from "@/lib/approvals/reports";

export const metadata = { title: "HR Report · MCCIA Approvals" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePage("viewer", "dg");
  const range = readRange(await searchParams);
  const r = await hrReport(range);
  const max = Math.max(1, ...r.byMonth.map((m) => m.total));

  return (
    <>
      <PageHeader title="HR Report" intro="How many HR requests came in, by category and by month, and what became of them." />
      <RangeForm {...range} />
      <p className="mb-5 text-[var(--z-muted)]"><b className="text-[var(--z-text)]">{r.total}</b> requests{r.amountPaise > 0 ? <> · <b className="text-[var(--z-text)]">{formatINR(r.amountPaise, { symbol: true })}</b> in amounts</> : null}</p>

      <h2 className="mb-2">By month</h2>
      <div className="table-wrap mb-8 max-w-3xl">
        <table>
          <thead><tr><th>Month</th><th className="w-1/2">Requests</th><th className="text-right">Amount (₹)</th></tr></thead>
          <tbody>
            {r.byMonth.length === 0 && <tr><td colSpan={3} className="!py-6 text-center text-[var(--z-muted)]">No HR requests in this period.</td></tr>}
            {r.byMonth.map((m) => (
              <tr key={m.month}>
                <td className="whitespace-nowrap">{monthLabel(m.month)}</td>
                <td><div className="flex items-center gap-2"><div className="zbar flex-1" role="img" aria-label={`${m.total} requests`}><span style={{ width: `${(m.total / max) * 100}%` }} /></div><span className="w-8 text-right font-bold">{m.total}</span></div></td>
                <td className="text-right">{m.amountPaise ? formatINR(m.amountPaise) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2">By category</h2>
      <div className="table-wrap max-w-3xl">
        <table>
          <thead><tr><th>Category</th><th className="text-right">Total</th><th className="text-right">Approved</th><th className="text-right">Pending</th><th className="text-right">Rejected</th><th className="text-right">Amount (₹)</th></tr></thead>
          <tbody>
            {r.byCategory.length === 0 && <tr><td colSpan={6} className="!py-6 text-center text-[var(--z-muted)]">No HR requests in this period.</td></tr>}
            {r.byCategory.map((c) => (
              <tr key={c.name}>
                <td>{c.name}</td><td className="text-right font-bold">{c.total}</td><td className="text-right">{c.approved}</td><td className="text-right">{c.pending}</td><td className="text-right">{c.rejected}</td>
                <td className="text-right">{c.amountPaise ? formatINR(c.amountPaise) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
