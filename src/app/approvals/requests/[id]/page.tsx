import { notFound } from "next/navigation";
import { PageHeader } from "@/components/approvals/PageHeader";
import { RequestDetailView } from "@/components/approvals/RequestDetailView";
import { requirePage } from "@/lib/approvals/guard";
import { getRequestDetail } from "@/lib/approvals/request-queries";
import { recordViewed } from "@/lib/approvals/requests";
import { idSchema } from "@/lib/approvals/validation";

export const metadata = { title: "Request · MCCIA Approvals" };

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePage();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const detail = await getRequestDetail(id, user);
  if (!detail) notFound();
  // Noting that the approver opened it is a courtesy to the timeline: a failure here must never stop the page.
  await recordViewed(id, user).catch(() => {});
  // Right after submitting, the person who raised it sees a confirmation that stays on the page (a toast would be gone in seconds).
  const justSubmitted = (await searchParams).submitted === "1" && detail.requesterUserId === user.id;
  return (
    <>
      <PageHeader title="Request" />
      {justSubmitted && (
        <div role="status" className="mb-6 rounded-md border border-line bg-green-tint px-4 py-3 text-sm text-ink">
          <b>Request submitted: {detail.requestNo}.</b> Keep this number. When it is approved or rejected you will get a notification on the bell above, and it opens this page.
        </div>
      )}
      <RequestDetailView d={detail} />
    </>
  );
}
