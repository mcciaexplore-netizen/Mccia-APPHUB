import { Suspense } from "react";
import { MyDecisionsList } from "@/components/approvals/MyApprovalsViews";
import { PageHeader } from "@/components/approvals/PageHeader";
import { TableSkeleton } from "@/components/approvals/Skeletons";
import { MY_APPROVALS_ROLES } from "@/lib/approvals/approvals.manifest";
import { requirePage } from "@/lib/approvals/guard";
import { parseListParams } from "@/lib/approvals/list-params";

export const metadata = { title: "My Approvals · MCCIA Approvals" };

/** Requests this person approved or rejected, newest decision first. For people who decide; a 404 for anyone else. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage(...MY_APPROVALS_ROLES);
  const { page } = parseListParams(await searchParams);
  return (
    <div className="page-enter">
      <PageHeader title="My Approvals" intro="Requests you approved or rejected, the most recent first." />
      <Suspense fallback={<TableSkeleton />}>
        <MyDecisionsList user={user} page={page} path="/approvals/my-approvals" />
      </Suspense>
    </div>
  );
}
