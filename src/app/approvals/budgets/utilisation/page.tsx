import { PageHeader } from "@/components/approvals/PageHeader";
import { utilisationLevel } from "@/lib/approvals/calc";
import { utilisation } from "@/lib/approvals/budget-position";
import { financialYearOf, formatINR, isFinancialYear, recentFinancialYears } from "@/lib/approvals/format";
import { requirePage } from "@/lib/approvals/guard";

export const metadata = { title: "Budget Utilisation · MCCIA Approvals" };

const money = (p: number | null) => (p == null ? "—" : formatINR(p));

export default async function Page({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  await requirePage("viewer", "dg");
  const { fy } = await searchParams;
  const year = fy && isFinancialYear(fy) ? fy : financialYearOf();
  const years = [...new Set([year, ...recentFinancialYears()])].sort().reverse();
  const rows = await utilisation(year);
  const total = rows.reduce((a, r) => ({ allocated: a.allocated + (r.allocatedPaise ?? 0), spent: a.spent + r.spentPaise, pending: a.pending + r.pendingPaise }), { allocated: 0, spent: 0, pending: 0 });

  return (
    <>
      <PageHeader title="Budget Utilisation" intro="For each branch and category: what was allocated, what approved requests have used, what is still waiting for a decision, and what is left. Above 90% is amber, above 100% red." />
      <form method="get" className="mb-5 flex items-end gap-3">
        <label className="block"><span className="label-xs block">Financial year</span>
          <select className="input w-40" name="fy" defaultValue={year}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select>
        </label>
        <button className="btn btn-primary btn-sm">Apply</button>
      </form>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Branch</th><th>Category</th><th className="text-right">Allocated (₹)</th><th className="text-right">Spent (₹)</th><th className="text-right">Pending (₹)</th><th className="text-right">Remaining (₹)</th><th className="w-44">% used</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="!py-8 text-center text-[var(--z-muted)]">No budgets or spending for {year} yet.</td></tr>}
            {rows.map((r) => {
              const level = utilisationLevel(r.percent);
              return (
                <tr key={`${r.branchId}|${r.categoryId}`} data-level={level === "ok" ? undefined : level}>
                  <td>{r.branchName}</td><td>{r.categoryName}</td>
                  <td className="text-right">{r.allocatedPaise == null ? <span className="text-[var(--z-muted)]">No budget</span> : money(r.allocatedPaise)}</td>
                  <td className="text-right">{money(r.spentPaise)}</td><td className="text-right">{money(r.pendingPaise)}</td>
                  <td className={`text-right ${r.remainingPaise != null && r.remainingPaise < 0 ? "zf-neg" : ""}`}>{money(r.remainingPaise)}</td>
                  <td>
                    {r.percent == null ? <span className="text-[var(--z-muted)]">—</span> : (
                      <div className="flex items-center gap-2">
                        <div className="zbar flex-1" data-level={level} role="img" aria-label={`${r.percent}% used`}><span style={{ width: `${Math.min(100, r.percent)}%` }} /></div>
                        <span className="w-10 text-right font-bold">{r.percent}%</span>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="font-bold"><td colSpan={2}>Total</td><td className="text-right">{money(total.allocated)}</td><td className="text-right">{money(total.spent)}</td><td className="text-right">{money(total.pending)}</td><td className="text-right">{money(total.allocated - total.spent)}</td><td></td></tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}
