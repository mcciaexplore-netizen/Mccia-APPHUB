import { requireAdministrator } from "@/lib/permissions";
import { ConfirmProvider } from "@/components/ConfirmDialog";

export default async function AdministratorLayout({ children }: { children: React.ReactNode }) {
  await requireAdministrator();
  // The sections of Administrator are listed once, in the sidebar's Administrator menu; there is no second row of the same links here.
  return (
    <ConfirmProvider>
      <h1 className="mb-8 text-3xl sm:text-4xl">Administrator</h1>
      {children}
    </ConfirmProvider>
  );
}
