import { TimelineScreen } from "@/components/approvals/TimelineScreen";
import { notFound } from "next/navigation";
import { FULL_ACCESS_ROLES, isDgOnly } from "@/lib/approvals/approvals.manifest";
import { requirePage } from "@/lib/approvals/guard";

export const metadata = { title: "Approval Timeline · MCCIA Approvals" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage(...FULL_ACCESS_ROLES);
  if (isDgOnly(user.roles)) notFound(); // the Director General works from the Recommended Queue
  return <TimelineScreen title="Approval Timeline" intro="Follow any request, HR or expenditure, from submission to decision." search={await searchParams} user={user} path="/approvals/timeline" />;
}
