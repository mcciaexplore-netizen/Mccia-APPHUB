import { HubShell } from "@/components/HubShell";
import { MobileMenu } from "@/components/MobileMenu";
import { DesignSidebar } from "@/components/design/shell/DesignSidebar";
import { requireTeam } from "@/lib/design/dal";
import { pendingCount } from "@/lib/design/tickets";
import { noticeUnread } from "@/lib/notice-feed";

export const metadata = { title: "Design Team · MCCIA App Hub" };

/**
 * Design Team (the designers' application) inside the hub's frame, with its sidebar beside the pages. A lead who has not been given Design
 * Team can still open a ticket page from the admin board; they see the admin menu here.
 */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await requireTeam();
  const [unread, pending] = await Promise.all([noticeUnread(user.id), user.member ? Promise.resolve(0) : pendingCount()]);
  return (
    <HubShell user={{ name: user.name, role: user.hubRole }} unread={unread}>
      <div className="ds-root flex flex-col gap-6 lg:flex-row lg:items-start">
        <aside className="w-full shrink-0 lg:sticky lg:top-20 lg:w-60">
          <MobileMenu label="Design Team menu">
            <DesignSidebar section={user.member ? "team" : "admin"} roles={user.roles} pending={pending} />
          </MobileMenu>
        </aside>
        <div className="page-slot min-w-0 flex-1">{children}</div>
      </div>
    </HubShell>
  );
}
