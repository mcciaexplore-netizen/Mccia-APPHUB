import { HubShell } from "@/components/HubShell";
import { AttMenu } from "@/components/attendance/shell/AttMenu";
import { AttSidebar } from "@/components/attendance/shell/AttNav";
import { AttPwa } from "@/components/attendance/pwa/AttPwa";
import { requireAdmin } from "@/lib/attendance/dal";
import { unreadNotices } from "@/lib/attendance/host-adapter";
import { pendingCountAll } from "@/lib/attendance/approvals";

export const metadata = { title: "Attendance Admin · MCCIA App Hub" };

/** Attendance Admin (HR) inside the hub's frame, with its sidebar (Approvals shows how many requests are waiting). */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  const [unread, waiting] = await Promise.all([unreadNotices(user.id), pendingCountAll()]);
  return (
    <HubShell user={{ name: user.name, role: user.hubRole }} unread={unread}>
      <div className="att-root flex flex-col gap-6 md:flex-row md:items-start">
        <aside className="w-full shrink-0 md:sticky md:top-20 md:w-60 lg:w-64">
          <AttMenu label="Attendance Admin menu">
            <AttSidebar section="admin" roles={user.roles} badges={{ "/attendance/admin/approvals": waiting }} />
          </AttMenu>
        </aside>
        <div className="page-slot min-w-0 flex-1">{children}</div>
        <AttPwa userId={user.id} />
      </div>
    </HubShell>
  );
}
