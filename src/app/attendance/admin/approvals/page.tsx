import { Card, LinkTabs, PageHeader } from "@/components/attendance/ui";
import { Inbox } from "@/components/attendance/approvals/Inbox";
import { requireAdmin } from "@/lib/attendance/dal";
import { historyFor, hrQueue, pendingFor } from "@/lib/attendance/approvals";

export const metadata = { title: "Approvals · Attendance Admin" };

/**
 * HR's view of requests. Reporting managers decide their team's requests; HR see them all but cannot change them. HR decide only what was
 * sent to HR: people with no reporting manager (or whose manager is no longer active).
 *   Needs HR       what HR must decide (Approve / Reject)
 *   With managers  every request waiting for a manager, read only
 *   History        every decision: who approved or rejected it, and when (read only)
 */
export default async function AdminApprovalsPage({ searchParams }: PageProps<"/attendance/admin/approvals">) {
  const user = await requireAdmin();
  const t = (await searchParams).tab;
  const tab = t === "history" ? "history" : t === "pending" ? "pending" : "hr";
  const actor = { id: user.id, name: user.name, hr: true };
  const items = tab === "hr" ? await hrQueue(actor) : tab === "pending" ? (await pendingFor(actor, true)).filter((i) => !i.toHr) : await historyFor(actor, true);
  const subtitle =
    tab === "hr"
      ? "Requests from people with no reporting manager are sent to HR to decide."
      : tab === "pending"
        ? "Waiting for the reporting manager to decide. HR can see these but not approve or reject them."
        : "Every decision, with who made it and when. Decisions cannot be changed here.";
  return (
    <>
      <PageHeader
        title="Approvals"
        subtitle={subtitle}
        actions={
          <LinkTabs
            current={tab}
            tabs={[
              { key: "hr", label: "Needs HR", href: "/attendance/admin/approvals" },
              { key: "pending", label: "With managers", href: "/attendance/admin/approvals?tab=pending" },
              { key: "history", label: "History", href: "/attendance/admin/approvals?tab=history" },
            ]}
          />
        }
      />
      <Card pad={false}>
        <Inbox items={items} mode={tab === "history" ? "history" : "pending"} showApprover={tab !== "history"} />
      </Card>
    </>
  );
}
