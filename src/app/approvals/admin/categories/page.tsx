import { PageHeader } from "@/components/approvals/PageHeader";
import { MasterManager } from "@/components/approvals/MasterManager";
import { requirePage } from "@/lib/approvals/guard";
import { listMaster } from "@/lib/approvals/masters";

export const metadata = { title: "Expense Categories · MCCIA Approvals" };

export default async function Page() {
  await requirePage("approvals_admin");
  const items = await listMaster("categories", true);
  return (
    <>
      <PageHeader title="Expense Categories" intro="The Category dropdown on both expenditure forms. Items are never deleted, only made inactive, so old requests stay readable." />
      <MasterManager kind="categories" noun="category" items={items} />
    </>
  );
}
