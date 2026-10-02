import { requireHeadAdmin } from "@/lib/permissions";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { AdminNav } from "./AdminNav";

export default async function AdministratorLayout({ children }: { children: React.ReactNode }) {
  await requireHeadAdmin();
  return (
    <ConfirmProvider>
      <h1 className="text-3xl sm:text-4xl">Administrator</h1>
      <AdminNav />
      {children}
    </ConfirmProvider>
  );
}
