import { HubShell } from "@/components/HubShell";
import { MobileMenu } from "@/components/MobileMenu";
import { DesignSidebar } from "@/components/design/shell/DesignSidebar";
import { requireTeam } from "@/lib/design/dal";
import { pendingCount } from "@/lib/design/tickets";
import { noticeUnread } from "@/lib/notice-feed";

export const metadata = { title: "Design Team Admin · MCCIA App Hub" };

/** Design Team Admin (the creative team) inside the hub's frame, with its sidebar (for leads, Pending Review shows how many requests are waiting). */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await requireTeam();
  const [unread, pending] = await Promise.all([noticeUnread(user.id), user.lead ? pendingCount() : Promise.resolve(0)]);
  return (
    <HubShell user={{ name: user.name, role: user.hubRole }} unread={unread}>
      <div className="ds-root flex flex-col gap-6 lg:flex-row lg:items-start">
        <aside className="w-full shrink-0 lg:sticky lg:top-20 lg:w-60">
          <MobileMenu label="Design Team Admin menu">
            <DesignSidebar section="admin" roles={user.roles} pending={pending} />
          </MobileMenu>
        </aside>
        <div className="page-slot min-w-0 flex-1">{children}</div>
      </div>
    </HubShell>
  );
}
