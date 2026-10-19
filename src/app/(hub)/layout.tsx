import { requireUser } from "@/lib/permissions";
import { getVisibleDepartments } from "@/lib/access";
import { HubShell } from "@/components/HubShell";
import { approvalsEnabled } from "@/lib/approvals/flags";
import { hasRole, resolveAccess } from "@/lib/approvals/host-adapter";
import { reviewItemsFor } from "@/lib/approvals/request-queries";
import { noticeUnread } from "@/lib/notice-feed";

export const dynamic = "force-dynamic";

export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [departments, unread, approvals] = await Promise.all([
    getVisibleDepartments(user), noticeUnread(user.id),
    // Where this person works under Approval System (HR, Expenditure): nothing for someone who approves nothing. The Support Admin also gets the set-up screens.
    approvalsEnabled()
      ? resolveAccess().then(async (a) => (a.status === "ok" ? { review: await reviewItemsFor(a.user), setup: hasRole(a.user, "approvals_admin") } : { review: [], setup: false }))
      : Promise.resolve({ review: [], setup: false }),
  ]);

  return (
    <HubShell user={{ name: user.name, role: user.role, adminAreas: user.adminAreas }} departments={departments} showApprovals={approvalsEnabled()} review={approvals.review} showSetup={approvals.setup} unread={unread}>
      {children}
    </HubShell>
  );
}
