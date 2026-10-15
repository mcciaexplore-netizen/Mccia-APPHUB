import { BulkAdd } from "@/components/people/BulkAdd";
import { domainsLabel } from "@/lib/domains";
import { requireHeadAdmin } from "@/lib/permissions";

export const metadata = { title: "Bulk add users · MCCIA App Hub" };
// Each batch of people is created and emailed within one request; give it room.
export const maxDuration = 60;

export default async function Page() {
  await requireHeadAdmin();
  return <BulkAdd base="/administrator/users" domains={domainsLabel()} />;
}
