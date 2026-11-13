import { HubShell } from "@/components/HubShell";
import { MobileMenu } from "@/components/MobileMenu";
import { EruSidebar } from "@/components/eru/shell/EruSidebar";
import { requireAdmin } from "@/lib/eru/dal";
import { unreadNotices } from "@/lib/eru/host-adapter";
import { adminKpis } from "@/lib/eru/queries";

export const metadata = { title: "ERU Admin · MCCIA App Hub" };

/** ERU Admin inside the hub's frame, with its sidebar (Dashboard shows how many tracked changes wait for review). */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const [unread, k] = await Promise.all([unreadNotices(user.id), adminKpis()]);
  return (
    <HubShell user={{ name: user.name, role: user.hubRole }} unread={unread}>
      <div className="eru-root flex flex-col gap-6 lg:flex-row lg:items-start">
        <aside className="w-full shrink-0 lg:sticky lg:top-20 lg:w-60">
          <MobileMenu label="ERU Admin menu">
            <EruSidebar section="admin" roles={user.roles} pending={k.pendingChanges} />
          </MobileMenu>
        </aside>
        <div className="page-slot min-w-0 flex-1">{children}</div>
      </div>
    </HubShell>
  );
}
