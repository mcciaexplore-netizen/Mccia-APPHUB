import { requireAdministrator } from "@/lib/permissions";
import { adminTabsFor } from "@/lib/admin-tabs";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { AdminNav } from "./AdminNav";

export default async function AdministratorLayout({ children }: { children: React.ReactNode }) {
  const me = await requireAdministrator();
  return (
    <ConfirmProvider>
      <h1 className="text-3xl sm:text-4xl">Administrator</h1>
      <AdminNav tabs={adminTabsFor(me)} />
      {children}
    </ConfirmProvider>
  );
}
