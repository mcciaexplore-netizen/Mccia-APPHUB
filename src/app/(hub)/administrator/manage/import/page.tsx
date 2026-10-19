import { BulkAdd } from "@/components/people/BulkAdd";
import { domainsLabel } from "@/lib/domains";
import { requireArea } from "@/lib/permissions";

export const metadata = { title: "Bulk add users · MCCIA App Hub" };
// Each batch of people is created and emailed within one request; give it room.
export const maxDuration = 60;

/** Bulk add, reached from User Administration. */
export default async function Page() {
  await requireArea("import");
  return <BulkAdd base="/administrator/manage" domains={domainsLabel()} />;
}
