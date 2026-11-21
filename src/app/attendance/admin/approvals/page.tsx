import { Card, LinkTabs, PageHeader } from "@/components/attendance/ui";
import { Inbox } from "@/components/attendance/approvals/Inbox";
import { requireAdmin } from "@/lib/attendance/dal";
import { historyFor, pendingFor } from "@/lib/attendance/approvals";

export const metadata = { title: "Approvals · Attendance Admin" };

/** HR's single inbox: every pending leave, WFH, regularization, comp-off and timesheet (HR can decide anything), and every past decision. */
export default async function AdminApprovalsPage({ searchParams }: PageProps<"/attendance/admin/approvals">) {
  const user = await requireAdmin();
  const tab = (await searchParams).tab === "history" ? "history" : "pending";
  const actor = { id: user.id, name: user.name, hr: true };
  const items = tab === "pending" ? await pendingFor(actor, true) : await historyFor(actor, true);
  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle="Everything waiting, including requests sent to managers. Your own requests are decided by someone else."
        actions={<LinkTabs current={tab} tabs={[{ key: "pending", label: "Pending", href: "/attendance/admin/approvals" }, { key: "history", label: "History", href: "/attendance/admin/approvals?tab=history" }]} />}
      />
      <Card pad={false}>
        <Inbox items={items} mode={tab} showApprover />
      </Card>
    </>
  );
}
