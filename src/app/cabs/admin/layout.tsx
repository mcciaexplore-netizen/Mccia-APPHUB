import { ConfirmProvider } from "@/components/ConfirmDialog";
import { HubShell } from "@/components/HubShell";
import { MobileMenu } from "@/components/MobileMenu";
import { CabsAdminSidebar } from "@/components/cabs/AdminSidebar";
import { requireAdminPage } from "@/lib/cabs/guard";
import { requireUser } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cabs Admin · MCCIA App Hub" };

/** Cabs Admin opens inside the hub's own frame (its top bar), with its own sidebar beside the pages, the same way Inventory does. */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const [hubUser, user] = await Promise.all([requireUser(), requireAdminPage()]);
  return (
    <HubShell user={{ name: hubUser.name, role: hubUser.role }}>
      <ConfirmProvider>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <aside className="w-full shrink-0 lg:sticky lg:top-20 lg:w-64">
            <MobileMenu label="Cabs Admin menu"><CabsAdminSidebar roles={user.roles} /></MobileMenu>
          </aside>
          <div className="page-slot min-w-0 flex-1">{children}</div>
        </div>
      </ConfirmProvider>
    </HubShell>
  );
}
