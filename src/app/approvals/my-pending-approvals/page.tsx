import { Suspense } from "react";
import { MyPendingApprovalsList } from "@/components/approvals/MyApprovalsViews";
import { PageHeader } from "@/components/approvals/PageHeader";
import { TableSkeleton } from "@/components/approvals/Skeletons";
import { MY_APPROVALS_ROLES } from "@/lib/approvals/approvals.manifest";
import { requirePage } from "@/lib/approvals/guard";
import { parseListParams } from "@/lib/approvals/list-params";

export const metadata = { title: "Pending My Approval · MCCIA Approvals" };

/** Pending My Approval (headed above, with "Approval System"): requests waiting for this person's decision, every kind together, oldest first. For people who decide; a 404 for anyone else. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage(...MY_APPROVALS_ROLES);
  const { page } = parseListParams(await searchParams);
  return (
    <div className="page-enter">
      <PageHeader intro="Requests waiting for your decision, the one waiting longest first." />
      <Suspense fallback={<TableSkeleton />}>
        <MyPendingApprovalsList user={user} page={page} path="/approvals/my-pending-approvals" />
      </Suspense>
    </div>
  );
}
