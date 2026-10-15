import { TimelineScreen } from "@/components/approvals/TimelineScreen";
import { FULL_ACCESS_ROLES } from "@/lib/approvals/approvals.manifest";
import { requirePage } from "@/lib/approvals/guard";

export const metadata = { title: "HR Approval Timeline · MCCIA Approvals" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage(...FULL_ACCESS_ROLES);
  return <TimelineScreen title="HR Approval Timeline" intro="Follow one HR request from submission to decision." types={["hr"]} search={await searchParams} user={user} path="/approvals/hr/timeline" />;
}
