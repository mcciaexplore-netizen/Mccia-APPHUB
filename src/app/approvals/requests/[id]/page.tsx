import { notFound } from "next/navigation";
import { PageHeader } from "@/components/approvals/PageHeader";
import { RequestDetailView } from "@/components/approvals/RequestDetailView";
import { requirePage } from "@/lib/approvals/guard";
import { getRequestDetail } from "@/lib/approvals/request-queries";
import { recordViewed } from "@/lib/approvals/requests";
import { idSchema } from "@/lib/approvals/validation";

export const metadata = { title: "Request · MCCIA Approvals" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage();
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const detail = await getRequestDetail(id, user);
  if (!detail) notFound();
  // Noting that the approver opened it is a courtesy to the timeline: a failure here must never stop the page.
  await recordViewed(id, user).catch(() => {});
  return (
    <>
      <PageHeader title="Request" />
      <RequestDetailView d={detail} />
    </>
  );
}
