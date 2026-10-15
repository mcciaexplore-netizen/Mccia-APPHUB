import { MasterManager } from "@/components/approvals/MasterManager";
import { PageHeader } from "@/components/approvals/PageHeader";
import { requirePage } from "@/lib/approvals/guard";
import { listMaster } from "@/lib/approvals/masters";

export const metadata = { title: "Publications · MCCIA Approvals" };

export default async function Page() {
  await requirePage("approvals_admin");
  const [types, publications] = await Promise.all([listMaster("publication-types", true), listMaster("publications", true)]);
  return (
    <>
      <PageHeader title="Publications" intro="The Type of Publication and Publication dropdowns on the Expenses form, used when the category is Publication. Publications are filtered by their type." />
      <h2 className="mb-3 text-lg">Types of publication</h2>
      <MasterManager kind="publication-types" noun="publication type" items={types} />
      <h2 className="mb-3 mt-10 text-lg">Publications</h2>
      <MasterManager kind="publications" noun="publication" items={publications} parents={types.filter((t) => t.active).map((t) => ({ id: t.id, name: t.name }))} />
    </>
  );
}
