import { requireUser } from "@/lib/permissions";
import { getVisibleDepartments } from "@/lib/access";
import { HubShell } from "@/components/HubShell";
import { approvalsEnabled } from "@/lib/approvals/flags";
import { resolveAccess } from "@/lib/approvals/host-adapter";
import { reviewItemsFor } from "@/lib/approvals/request-queries";
import { noticeUnread } from "@/lib/notice-feed";

export const dynamic = "force-dynamic";

export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [departments, unread, review] = await Promise.all([
    getVisibleDepartments(user), noticeUnread(user.id),
    // Where this person works under Approval System (HR, Expenditure): nothing for someone who approves nothing.
    approvalsEnabled() ? resolveAccess().then((a) => (a.status === "ok" ? reviewItemsFor(a.user) : [])) : Promise.resolve([]),
  ]);

  return (
    <HubShell user={{ name: user.name, role: user.role, adminAreas: user.adminAreas }} departments={departments} showApprovals={approvalsEnabled()} review={review} unread={unread}>
      {children}
    </HubShell>
  );
}
