import { PageHeader } from "@/components/approvals/PageHeader";
import { HistoricalFiles } from "@/components/approvals/HistoricalFiles";
import { HistoricalImport } from "@/components/approvals/HistoricalImport";
import { requirePage } from "@/lib/approvals/guard";
import { listFileReferences } from "@/lib/approvals/historical/attachments";
import { listBatches } from "@/lib/approvals/historical/import";

export const metadata = { title: "Historical Import · MCCIA Approvals" };
export const dynamic = "force-dynamic";

export default async function Page() {
  await requirePage("approvals_admin");
  const [batches, files] = await Promise.all([listBatches(), listFileReferences()]);
  return (
    <>
      <PageHeader title="Historical Import" intro="Bring old approval records from another system into the Approval System as archived, read-only tickets, with their original details and approval history." />
      <HistoricalImport batches={batches} />
      <HistoricalFiles files={files} />
    </>
  );
}
