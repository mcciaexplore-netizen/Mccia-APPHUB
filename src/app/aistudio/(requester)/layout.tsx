import { HubShell } from "@/components/HubShell";
import { MobileMenu } from "@/components/MobileMenu";
import { AiSidebar } from "@/components/aistudio/shell/AiSidebar";
import { requireRequester } from "@/lib/aistudio/dal";
import { unreadNotices } from "@/lib/aistudio/host-adapter";

export const metadata = { title: "AI Studio · MCCIA App Hub" };

/** The request pages (AI Studio): the form and the person's own requests, inside the hub's frame. */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await requireRequester();
  const unread = await unreadNotices(user.id);
  return (
    <HubShell user={{ name: user.name, role: user.hubRole }} unread={unread}>
      <div className="ai-root flex flex-col gap-6 lg:flex-row lg:items-start">
        <aside className="w-full shrink-0 lg:sticky lg:top-20 lg:w-60">
          <MobileMenu label="AI Studio menu">
            <AiSidebar section="requester" roles={user.roles} />
          </MobileMenu>
        </aside>
        <div className="page-slot min-w-0 flex-1">{children}</div>
      </div>
    </HubShell>
  );
}
