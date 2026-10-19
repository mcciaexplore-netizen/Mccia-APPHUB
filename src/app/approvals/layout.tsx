import "@/components/approvals/approvals.css";
import { Suspense } from "react";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { HubShell } from "@/components/HubShell";
import { ModuleHeader } from "@/components/approvals/ModuleHeader";
import { requirePage } from "@/lib/approvals/guard";
import { unreadCount } from "@/lib/approvals/notify";
import { requireUser } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approval System · MCCIA App Hub" };

/**
 * Approval System opens inside the hub's own frame (its top bar), like the Administrator pages. It sits beside the hub's
 * layout group rather than inside it, on purpose: the hub's loading screen would start streaming the page early, and then a missing page
 * or a redirect could no longer answer with a real 404 or redirect.
 */
export default async function ApprovalsLayout({ children }: { children: React.ReactNode }) {
  const [hubUser, user] = await Promise.all([requireUser(), requirePage()]);
  const unread = await unreadCount(user.id);
  return (
    <HubShell user={{ name: hubUser.name, role: hubUser.role }}>
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
