import { requireHeadAdmin } from "@/lib/permissions";
import { getPendingUserCount } from "@/lib/access";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { AdminNav } from "./AdminNav";

export default async function AdministratorLayout({ children }: { children: React.ReactNode }) {
  // The count is the same query the hub layout runs, so it is shared; checking the admin runs alongside it.
  const [, pendingUsers] = await Promise.all([requireHeadAdmin(), getPendingUserCount()]);
  return (
    <ConfirmProvider>
      <h1 className="text-3xl sm:text-4xl">Administrator</h1>
      <AdminNav pendingUsers={pendingUsers} />
      {children}
    </ConfirmProvider>
  );
}
