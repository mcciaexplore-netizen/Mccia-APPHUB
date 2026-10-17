import { PageHeader } from "@/components/approvals/PageHeader";
import { MasterManager } from "@/components/approvals/MasterManager";
import { requirePage } from "@/lib/approvals/guard";
import { listMaster } from "@/lib/approvals/masters";

export const metadata = { title: "Branches · MCCIA Approvals" };

export default async function Page() {
  await requirePage("approvals_admin");
  const items = await listMaster("branches", true);
  return (
    <>
      <PageHeader title="Branches" intro="The Branch Name dropdown on the expenditure forms." />
      <MasterManager kind="branches" noun="branch" items={items} />
    </>
  );
}
