import { ConfirmProvider } from "@/components/ConfirmDialog";
import { HubShell } from "@/components/HubShell";
import { MobileMenu } from "@/components/MobileMenu";
import { InventorySidebar } from "@/components/inventory/InventorySidebar";
import { requirePage } from "@/lib/inventory/guard";
import { requireUser } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inventory · MCCIA App Hub" };

/**
 * Inventory opens inside the hub's own frame (its top bar), with its own sidebar beside the pages, the same way the Approval System does
 * (src/app/approvals/layout.tsx). It sits beside the hub's layout group rather than inside it, so a missing page or a redirect can still
 * answer with a real 404 or redirect.
 */
export default async function InventoryLayout({ children }: { children: React.ReactNode }) {
  const [hubUser, user] = await Promise.all([requireUser(), requirePage()]);
  return (
    <HubShell user={{ name: hubUser.name, role: hubUser.role }}>
      <ConfirmProvider>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <aside className="w-full shrink-0 lg:sticky lg:top-20 lg:w-72">
            <MobileMenu label="Inventory menu"><InventorySidebar roles={user.roles} branchName={user.branchName} /></MobileMenu>
          </aside>
          <div className="page-slot min-w-0 flex-1">{children}</div>
        </div>
      </ConfirmProvider>
    </HubShell>
  );
}
