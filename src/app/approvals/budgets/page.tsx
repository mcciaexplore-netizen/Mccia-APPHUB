import { BudgetsManager } from "@/components/approvals/BudgetsManager";
import { PageHeader } from "@/components/approvals/PageHeader";
import { listBudgets } from "@/lib/approvals/budgets";
import { financialYearOf, isFinancialYear, recentFinancialYears } from "@/lib/approvals/format";
import { requirePage } from "@/lib/approvals/guard";
import { hasRole } from "@/lib/approvals/host-adapter";
import { listMaster } from "@/lib/approvals/masters";

export const metadata = { title: "Budgets · MCCIA Approvals" };

export default async function Page({ searchParams }: { searchParams: Promise<{ fy?: string }> }) {
  const user = await requirePage("viewer", "dg");
  const { fy } = await searchParams;
  const year = fy && isFinancialYear(fy) ? fy : financialYearOf();
  const canEdit = hasRole(user, "approvals_admin");
  const [rows, branches, categories] = await Promise.all([
    listBudgets({ financialYear: year }),
    canEdit ? listMaster("branches", false) : Promise.resolve([]),
    canEdit ? listMaster("categories", false) : Promise.resolve([]),
  ]);
  const years = [...new Set([year, ...recentFinancialYears()])].sort().reverse();
  return (
    <>
      <PageHeader
        title="Budgets"
        intro="What is allocated to each branch and category for the financial year (April to March). Remaining budget on the forms is this amount minus approved spend."
      />
      <BudgetsManager
        rows={rows} years={years} year={year} canEdit={canEdit}
        branches={branches.map((b) => ({ id: b.id, name: b.name }))} categories={categories.map((c) => ({ id: c.id, name: c.name }))}
      />
    </>
  );
}
