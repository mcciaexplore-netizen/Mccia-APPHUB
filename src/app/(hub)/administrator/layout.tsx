import { Suspense } from "react";
import { AdminSidebar } from "@/components/AdminSidebar";
import { AdminBackLink } from "@/components/BackLink";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { MobileMenu } from "@/components/MobileMenu";
import { adminTabsFor } from "@/lib/admin-tabs";
import { requireAdministrator } from "@/lib/permissions";

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
            <MobileMenu label="Administrator menu"><AdminSidebar tabs={adminTabsFor(me)} /></MobileMenu>
          </Suspense>
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </ConfirmProvider>
  );
}
