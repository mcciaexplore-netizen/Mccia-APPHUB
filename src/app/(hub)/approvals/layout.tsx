import "@/components/approvals/approvals.css";
import { Suspense } from "react";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { ModuleFrame } from "@/components/approvals/ModuleFrame";
import { requirePage } from "@/lib/approvals/guard";
import { unreadCount } from "@/lib/approvals/notify";
import { waitingCount } from "@/lib/approvals/request-queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approval System · MCCIA App Hub" };

/** Inside the hub's own layout: the hub supplies the sidebar and top bar, this adds the application's title, tabs and bell. */
export default async function ApprovalsLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePage();
  const [unread, waiting] = await Promise.all([unreadCount(user.id), waitingCount(user)]);
  return (
    <ConfirmProvider>
      <Suspense fallback={null}>
        <ModuleFrame roles={user.roles} unread={unread} waiting={waiting}>{children}</ModuleFrame>
      </Suspense>
    </ConfirmProvider>
  );
}
