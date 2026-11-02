import { HubShell } from "@/components/HubShell";
import { MobileMenu } from "@/components/MobileMenu";
import { DesignSidebar } from "@/components/design/shell/DesignSidebar";
import { requireRequester } from "@/lib/design/dal";
import { noticeUnread } from "@/lib/notice-feed";

export const metadata = { title: "Design Requests · MCCIA App Hub" };

/** The request pages, open to every signed-in hub user. Designers see their Design Team menu here; everyone else the requests menu. */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await requireRequester();
  const unread = await noticeUnread(user.id);
  return (
    <HubShell user={{ name: user.name, role: user.hubRole }} unread={unread}>
      <div className="ds-root flex flex-col gap-6 lg:flex-row lg:items-start">
        <aside className="w-full shrink-0 lg:sticky lg:top-20 lg:w-60">
          <MobileMenu label="Design Requests menu">
            <DesignSidebar section={user.member ? "team" : "requester"} roles={user.roles} />
          </MobileMenu>
        </aside>
        <div className="page-slot min-w-0 flex-1">{children}</div>
      </div>
    </HubShell>
  );
}
