import "@/components/approvals/approvals.css";
import { Suspense } from "react";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { HubShell } from "@/components/HubShell";
import { ModuleMenu } from "@/components/approvals/ModuleMenu";
import { getVisibleDepartments } from "@/lib/access";
import { requirePage } from "@/lib/approvals/guard";
import { unreadCount } from "@/lib/approvals/notify";
import { waitingCount } from "@/lib/approvals/request-queries";
import { requireUser } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approval System · MCCIA App Hub" };

/**
 * Approval System opens inside the hub's own frame (its sidebar and top bar), like the Administrator pages. It sits beside the hub's
 * layout group rather than inside it, on purpose: the hub's loading screen would start streaming the page early, and then a missing page
 * or a redirect could no longer answer with a real 404 or redirect.
 */
export default async function ApprovalsLayout({ children }: { children: React.ReactNode }) {
  const hubUser = await requireUser();
  const user = await requirePage();
  const [departments, unread, waiting] = await Promise.all([getVisibleDepartments(hubUser), unreadCount(user.id), waitingCount(user)]);
  return (
    <HubShell user={{ name: hubUser.name, role: hubUser.role, adminAreas: hubUser.adminAreas }} departments={departments} approvalApps={user.apps}>
      <ConfirmProvider>
        <div className="apr-root">
          <Suspense fallback={null}>
            {/* waitingCount is already limited to what is waiting for this person, so it serves the DG's queue and an approver's pending page alike. */}
            <ModuleMenu roles={user.roles} apps={user.apps} unread={unread} waiting={waiting} pendingForMe={waiting} />
          </Suspense>
          <div className="mt-6">{children}</div>
        </div>
      </ConfirmProvider>
    </HubShell>
  );
}
