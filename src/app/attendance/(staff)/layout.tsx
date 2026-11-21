import { HubShell } from "@/components/HubShell";
import { AttBottomNav, AttSidebar } from "@/components/attendance/shell/AttNav";
import { requireMember } from "@/lib/attendance/dal";
import { unreadNotices } from "@/lib/attendance/host-adapter";
import { pendingCountFor } from "@/lib/attendance/approvals";

export const metadata = { title: "Attendance · MCCIA App Hub" };

/** The staff app inside the hub's frame: a sidebar from a laptop up, a bottom bar (Home, Leave, Time, More) on a phone. */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await requireMember();
  const [unread, waiting] = await Promise.all([unreadNotices(user.id), pendingCountFor(user.id)]);
  const badges = { "/attendance/more": waiting };
  return (
    <HubShell user={{ name: user.name, role: user.hubRole }} unread={unread}>
      <div className="att-root att-has-bottom-nav flex flex-col gap-6 lg:flex-row lg:items-start">
        <aside className="hidden w-60 shrink-0 lg:sticky lg:top-20 lg:block">
          <AttSidebar section="staff" roles={user.roles} badges={badges} />
        </aside>
        <div className="page-slot min-w-0 flex-1">{children}</div>
        <AttBottomNav roles={user.roles} badges={badges} />
      </div>
    </HubShell>
  );
}
