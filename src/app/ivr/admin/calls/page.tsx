import { CallsView } from "@/components/ivr/calls/calls-view";
import { requireAdmin } from "@/lib/ivr/dal";

export const metadata = { title: "Team calls" };

/** Every agent's calls, team-wide. Press a row to open the member beside the list. */
export default async function TeamCallsPage({ searchParams }: PageProps<"/ivr/admin/calls">) {
  const user = await requireAdmin();
  return <CallsView user={user} sp={await searchParams} base="/ivr/admin/calls" team />;
}
