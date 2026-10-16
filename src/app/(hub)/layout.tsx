import { requireUser } from "@/lib/permissions";
import { getVisibleDepartments } from "@/lib/access";
import { HubShell } from "@/components/HubShell";
import { approvalsEnabled } from "@/lib/approvals/flags";
import { resolveAccess } from "@/lib/approvals/host-adapter";
import { noticeUnread } from "@/lib/notice-feed";

export const dynamic = "force-dynamic";

export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [departments, unread, access] = await Promise.all([getVisibleDepartments(user), noticeUnread(user.id), approvalsEnabled() ? resolveAccess() : null]);
  // The Approval System item lists only the applications the Support Admin has given this person (all of them for approvers and admins).
  const approvalApps = access?.status === "ok" ? access.user.apps : [];

  return (
    <HubShell user={{ name: user.name, role: user.role, adminAreas: user.adminAreas }} departments={departments} approvalApps={approvalApps} unread={unread}>
      {children}
    </HubShell>
  );
}
