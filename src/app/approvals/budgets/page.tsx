import { BackLink } from "@/components/BackLink";
import { BudgetsEditor } from "@/components/approvals/BudgetsEditor";
import { budgetTable } from "@/lib/approvals/budget";
import { financialYearOf, isFinancialYear, recentFinancialYears } from "@/lib/approvals/format";
import { requirePage } from "@/lib/approvals/guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Budgets · MCCIA Approvals" };

/** Budgets per expense category and financial year: set by the Director General (or the Support Admin); used and left are worked out. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePage("dg", "approvals_admin");
  const sp = await searchParams;
  const fy = typeof sp.fy === "string" && isFinancialYear(sp.fy) ? sp.fy : financialYearOf();
  const years = recentFinancialYears(4);
  const lines = await budgetTable(fy);
  return (
    <div className="page-enter space-y-6">
      <div>
        <BackLink href="/approvals" label="Back to Approval Forms" />
        <h1 className="mt-1 text-2xl text-ink sm:text-3xl">Budgets</h1>
        <p className="mt-1 text-sm text-subtle">Set the budget of each expense category. Every approved request is taken off it automatically.</p>
      </div>
      <BudgetsEditor key={fy} financialYear={fy} years={years.includes(fy) ? years : [fy, ...years]} lines={lines.map((l) => ({ categoryId: l.categoryId, name: l.name, allocatedPaise: l.allocatedPaise, usedPaise: l.usedPaise, pendingPaise: l.pendingPaise, updatedByName: l.updatedByName }))} />
    </div>
  );
}
