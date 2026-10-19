import "@/components/approvals/approvals.css";
import { Suspense } from "react";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { HubShell } from "@/components/HubShell";
import { ModuleHeader } from "@/components/approvals/ModuleHeader";
import { getVisibleDepartments } from "@/lib/access";
import { requirePage } from "@/lib/approvals/guard";
import { hasRole } from "@/lib/approvals/host-adapter";
import { unreadCount } from "@/lib/approvals/notify";
import { reviewItemsFor } from "@/lib/approvals/request-queries";
import { requireUser } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approval System · MCCIA App Hub" };

/**
 * Approval System opens inside the hub's own frame (its sidebar and top bar), like the Administrator pages. It sits beside the hub's
 * layout group rather than inside it, on purpose: the hub's loading screen would start streaming the page early, and then a missing page
 * or a redirect could no longer answer with a real 404 or redirect.
 */
export default async function ApprovalsLayout({ children }: { children: React.ReactNode }) {
  const [hubUser, user] = await Promise.all([requireUser(), requirePage()]);
  const [departments, unread, review] = await Promise.all([getVisibleDepartments(hubUser), unreadCount(user.id), reviewItemsFor(user)]);
  return (
    <HubShell user={{ name: hubUser.name, role: hubUser.role, adminAreas: hubUser.adminAreas }} departments={departments} showApprovals review={review} showSetup={hasRole(user, "approvals_admin")}>
      <ConfirmProvider>
        <div className="apr-root">
          <Suspense fallback={null}>
            <ModuleHeader roles={user.roles} unread={unread} />
          </Suspense>
          <div className="mt-6">{children}</div>
        </div>
      </ConfirmProvider>
    </HubShell>
  );
}
