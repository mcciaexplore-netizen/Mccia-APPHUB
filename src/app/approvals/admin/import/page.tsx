import { PageHeader } from "@/components/approvals/PageHeader";
import { HistoricalImport } from "@/components/approvals/HistoricalImport";
import { requirePage } from "@/lib/approvals/guard";
import { listBatches } from "@/lib/approvals/historical/import";

export const metadata = { title: "Historical Import · MCCIA Approvals" };
export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePage("approvals_admin");
  const batches = await listBatches();
  return (
    <>
      <PageHeader title="Historical Import" intro="Bring old approval records from another system into the Approval System as archived, read-only tickets, with their original details and approval history." />
      <HistoricalImport batches={batches} />
    </>
  );
}
