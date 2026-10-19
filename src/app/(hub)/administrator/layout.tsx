import { Suspense } from "react";
import { AdminSidebar } from "@/components/AdminSidebar";
import { AdminBackLink } from "@/components/BackLink";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { adminTabsFor } from "@/lib/admin-tabs";
import { SETUP_GROUP_LABEL, approvalsApps, isGroup } from "@/lib/approvals/approvals.manifest";
import { approvalsEnabled } from "@/lib/approvals/flags";
import { requireAdministrator } from "@/lib/permissions";
import { isSuper } from "@/lib/rbac";

/** The Approval System's settings screens (Who Approves What, Expense Types, ...), read from its menu data. */
const APPROVAL_SETTINGS = approvalsApps
  .flatMap((a) => a.nav)
  .flatMap((e) => (isGroup(e) && e.label === SETUP_GROUP_LABEL ? e.items : []))
  .map((i) => ({ label: i.label, href: i.href! }));

/** Administrator: its sidebar on the left (stacked above on a phone) and the section's page beside it. */
export default async function AdministratorLayout({ children }: { children: React.ReactNode }) {
  const me = await requireAdministrator();
  return (
    <ConfirmProvider>
      <AdminBackLink />
      <h1 className="mb-6 text-3xl sm:text-4xl">Administrator</h1>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <aside className="w-full shrink-0 lg:sticky lg:top-20 lg:w-64">
          <Suspense fallback={null}>
            <AdminSidebar tabs={adminTabsFor(me)} approvalSettings={isSuper(me) && approvalsEnabled() ? APPROVAL_SETTINGS : []} />
          </Suspense>
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </ConfirmProvider>
  );
}
