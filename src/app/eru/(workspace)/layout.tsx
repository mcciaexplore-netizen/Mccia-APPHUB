import { HubShell } from "@/components/HubShell";
import { MobileMenu } from "@/components/MobileMenu";
import { EruSidebar } from "@/components/eru/shell/EruSidebar";
import { requireMember } from "@/lib/eru/dal";
import { unreadNotices } from "@/lib/eru/host-adapter";

export const metadata = { title: "ERU · MCCIA App Hub" };

/** The ERU workspace (domains and projects) inside the hub's frame, with its sidebar. The document editor has its own, wider layout. */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await requireMember();
  const unread = await unreadNotices(user.id);
  return (
    <HubShell user={{ name: user.name, role: user.hubRole }} unread={unread}>
      <div className="eru-root flex flex-col gap-6 lg:flex-row lg:items-start">
        <aside className="w-full shrink-0 lg:sticky lg:top-20 lg:w-60">
          <MobileMenu label="ERU menu">
            <EruSidebar section="workspace" roles={user.roles} />
          </MobileMenu>
        </aside>
        <div className="page-slot min-w-0 flex-1">{children}</div>
      </div>
    </HubShell>
  );
}
