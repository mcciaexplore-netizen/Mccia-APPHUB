import { PageHeader } from "@/components/approvals/PageHeader";
import { MasterManager } from "@/components/approvals/MasterManager";
import { requirePage } from "@/lib/approvals/guard";
import { listMaster } from "@/lib/approvals/masters";

export const metadata = { title: "HR Approval Categories · MCCIA Approvals" };

export default async function Page() {
  await requirePage("approvals_admin");
  const items = await listMaster("hr-categories", true);
  return (
    <>
      <PageHeader title="HR Approval Categories" intro="The Category dropdown on the HR form. Add a new one any time; it shows up for staff straight away." />
      <MasterManager kind="hr-categories" noun="HR category" items={items} />
    </>
  );
}
