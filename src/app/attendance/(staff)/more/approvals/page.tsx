import Link from "next/link";
import { Card, LinkTabs, PageHeader } from "@/components/attendance/ui";
import { Inbox } from "@/components/attendance/approvals/Inbox";
import { requireMember } from "@/lib/attendance/dal";
import { historyFor, pendingFor } from "@/lib/attendance/approvals";

export const metadata = { title: "Team approvals · Attendance" };

/** A manager's inbox: requests their reports sent them, and what they decided. */
export default async function TeamApprovalsPage({ searchParams }: PageProps<"/attendance/more/approvals">) {
  const user = await requireMember();
  const tab = (await searchParams).tab === "history" ? "history" : "pending";
  const actor = { id: user.id, name: user.name, hr: user.admin };
  const items = tab === "pending" ? await pendingFor(actor) : await historyFor(actor);
  return (
    <>
      <PageHeader
        title="Team approvals"
        subtitle={user.admin ? <>Requests sent to you by name. Everything else is in <Link href="/attendance/admin/approvals" className="font-semibold text-[var(--att-blue)]">Attendance Admin → Approvals</Link>.</> : "Requests from the people who report to you."}
        actions={<LinkTabs current={tab} tabs={[{ key: "pending", label: "Waiting", href: "/attendance/more/approvals" }, { key: "history", label: "History", href: "/attendance/more/approvals?tab=history" }]} />}
      />
      <Card pad={false}>
        <Inbox items={items} mode={tab} />
      </Card>
    </>
  );
}
