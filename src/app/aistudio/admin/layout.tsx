import { HubShell } from "@/components/HubShell";
import { MobileMenu } from "@/components/MobileMenu";
import { AiSidebar } from "@/components/aistudio/shell/AiSidebar";
import { requireTeam } from "@/lib/aistudio/dal";
import { unreadNotices } from "@/lib/aistudio/host-adapter";
import { pendingCount } from "@/lib/aistudio/queries";

export const metadata = { title: "AI Studio Admin · MCCIA App Hub" };

/** AI Studio Admin (the team) inside the hub's frame, with its sidebar (Pending Review shows how many requests are waiting). */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await requireTeam();
  const [unread, pending] = await Promise.all([unreadNotices(user.id), pendingCount()]);
  return (
    <HubShell user={{ name: user.name, role: user.hubRole }} unread={unread}>
      <div className="ai-root flex flex-col gap-6 lg:flex-row lg:items-start">
        <aside className="w-full shrink-0 lg:sticky lg:top-20 lg:w-60">
          <MobileMenu label="AI Studio Admin menu">
            <AiSidebar section="admin" roles={user.roles} pending={pending} />
          </MobileMenu>
        </aside>
        <div className="page-slot min-w-0 flex-1">{children}</div>
      </div>
    </HubShell>
  );
}
