import { PageHeader } from "@/components/approvals/PageHeader";
import { MasterManager } from "@/components/approvals/MasterManager";
import { requirePage } from "@/lib/approvals/guard";
import { listMaster } from "@/lib/approvals/masters";

export const metadata = { title: "Departments · MCCIA Approvals" };

/** The Budget form's Department list (besides the hub's own departments, which are shown there too and are changed in the hub). */
export default async function Page() {
  await requirePage("approvals_admin");
  const items = await listMaster("departments", true);
  return (
    <>
      <PageHeader title="Departments" intro="The Department dropdown on the Budget form, alongside the hub's own departments. Staff can add one by typing it on the form; rename or retire them here." />
      <MasterManager kind="departments" noun="department" items={items} />
    </>
  );
}
