import { notFound } from "next/navigation";
import { PageHeader } from "@/components/approvals/PageHeader";
import { RequestDetailView } from "@/components/approvals/RequestDetailView";
import { requirePage } from "@/lib/approvals/guard";
import { submitterOf } from "@/lib/approvals/host-adapter";
import { appForType, approvalsApps } from "@/lib/approvals/approvals.manifest";
import { getRequestDetail } from "@/lib/approvals/request-queries";
import { recordViewed } from "@/lib/approvals/requests";
import { idSchema } from "@/lib/approvals/validation";

export const metadata = { title: "Request · MCCIA Approvals" };

/** "Budget Approval" for a budget; otherwise the name of the application the request belongs to (HR Approval, Expenditure). */
const formTitle = (type: Parameters<typeof appForType>[0]) =>
  type === "budget" ? "Budget Approval" : approvalsApps.find((a) => a.key === appForType(type))?.title ?? "Request";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const detail = await getRequestDetail(id, user);
  if (!detail) notFound();
  // Noting that the approver opened it is a courtesy to the timeline: a failure here must never stop the page.
  const [, sp, submitter] = await Promise.all([recordViewed(id, user).catch(() => {}), searchParams, submitterOf(detail.requesterUserId)]);
  // Right after submitting, the person who raised it sees a confirmation that stays on the page (a toast would be gone in seconds).
  const justSubmitted = sp.submitted === "1" && detail.requesterUserId === user.id;
  return (
    <div className="page-enter">
      {/* The form this request was raised with, as the page's main heading (the header above leaves it to this page). */}
      <h1 className="apr-no-print -mt-4 mb-6 text-2xl text-ink sm:text-3xl" data-testid="request-heading">{formTitle(detail.type)}</h1>
      <div className="apr-no-print"><PageHeader title="Request" /></div>
      {justSubmitted && (
        <div role="status" className="apr-no-print mb-6 rounded-md border border-line bg-green-tint px-4 py-3 text-sm text-ink">
          {detail.budget && !detail.requestNo
            ? <><b>Budget submitted.</b> Its Budget ID is given when it is approved. You will get a notification on the bell above when it is decided, and it opens this page.</>
            : <><b>Request submitted: {detail.requestNo}.</b> Keep this number. When it is approved or rejected you will get a notification on the bell above, and it opens this page.</>}
        </div>
      )}
      <RequestDetailView d={detail} submitter={submitter ?? { name: detail.requesterName, department: null }} viewerName={user.name} />
    </div>
  );
}
