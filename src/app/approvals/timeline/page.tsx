import { TimelineScreen } from "@/components/approvals/TimelineScreen";
import { requirePage } from "@/lib/approvals/guard";

export const metadata = { title: "Approval Timeline · MCCIA Approvals" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage();
  return <TimelineScreen title="Approval Timeline" intro="Follow any request, HR or expenditure, from submission to decision." search={await searchParams} user={user} path="/approvals/timeline" />;
}
