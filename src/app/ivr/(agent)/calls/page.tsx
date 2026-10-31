import { CallsView } from "@/components/ivr/calls/calls-view";
import { requireUser } from "@/lib/ivr/dal";

export const metadata = { title: "My calls" };

/** The calls the signed-in agent handled themselves, nobody else's. Press a row to open the member beside the list. */
export default async function MyCallsPage({ searchParams }: PageProps<"/ivr/calls">) {
  const user = await requireUser();
  return <CallsView user={user} sp={await searchParams} base="/ivr/calls" team={false} />;
}
