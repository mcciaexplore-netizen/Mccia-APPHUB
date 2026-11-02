import Link from "next/link";
import { Download } from "lucide-react";
import { ReportCharts } from "@/components/design/admin/reports/charts";
import { Kpi, PageHeader } from "@/components/design/ui";
import { requireLead } from "@/lib/design/dal";
import { report } from "@/lib/design/reports";
import { addDays, daysBetween, istDate } from "@/lib/design/rules";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** SLA and performance for a period (default the last 30 days), with CSV and PDF export of the same period. */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requireLead();
  const sp = await searchParams;
  const today = istDate();
  let to = sp.to && DAY.test(sp.to) ? sp.to : today;
  let from = sp.from && DAY.test(sp.from) ? sp.from : addDays(to, -29);
  if (from > to) [from, to] = [to, from];
  if (daysBetween(from, to) > 366) from = addDays(to, -366);
  const r = await report(from, to);
  const rate = r.totals.delivered ? `${Math.round((r.totals.onTime / r.totals.delivered) * 100)}%` : "–";
  const quick = [7, 30, 90].map((n) => ({ n, href: `/design/admin/reports?from=${addDays(today, -(n - 1))}&to=${today}`, on: to === today && from === addDays(today, -(n - 1)) }));
  const q = `from=${from}&to=${to}`;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Reports"
        subtitle="Deadlines met, turnaround, revisions and hours for the period you choose."
        actions={
          <>
            <a href={`/api/design/reports/export?${q}&format=csv`} className="btn btn-ghost btn-sm">
              <Download size={14} /> Export CSV
            </a>
            <a href={`/api/design/reports/export?${q}&format=pdf`} className="btn btn-sm ds-btn-navy">
              <Download size={14} /> Export PDF
            </a>
          </>
        }
      />
      <form className="ds-card flex flex-wrap items-end gap-3 p-4" method="get">
        <label className="flex flex-col gap-1">
          <span className="ds-label">From</span>
          <input type="date" name="from" className="input !py-2" defaultValue={from} max={today} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="ds-label">To</span>
          <input type="date" name="to" className="input !py-2" defaultValue={to} max={today} />
        </label>
        <button type="submit" className="btn btn-sm ds-btn-navy">
          Show
        </button>
        <nav className="ds-tabs ml-auto" aria-label="Quick periods">
          {quick.map((x) => (
            <Link key={x.n} href={x.href} className="ds-tab" aria-current={x.on ? "page" : undefined}>
              Last {x.n} days
            </Link>
          ))}
        </nav>
      </form>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Requests" value={r.totals.created} />
        <Kpi label="Delivered" value={r.totals.delivered} tone="green" />
        <Kpi label="On time" value={rate} tone={r.totals.delivered && r.totals.onTime / r.totals.delivered < 0.8 ? "red" : "green"} />
        <Kpi label="Revisions" value={r.totals.revisions} tone="purple" />
        <Kpi label="Hours logged" value={r.totals.hours} />
      </div>
      <ReportCharts report={r} />
    </div>
  );
}
