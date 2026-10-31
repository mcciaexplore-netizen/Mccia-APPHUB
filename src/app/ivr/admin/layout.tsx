import { HubShell } from "@/components/HubShell";
import { MobileMenu } from "@/components/MobileMenu";
import { AutoSync } from "@/components/ivr/shell/auto-sync";
import { IvrSidebar } from "@/components/ivr/shell/IvrSidebar";
import { requireAdmin } from "@/lib/ivr/dal";
import { getOrgIntegration } from "@/lib/ivr/smartflo";
import { noticeUnread } from "@/lib/notice-feed";
import { requireUser } from "@/lib/permissions";

export const metadata = { title: "IVR-CRM Admin · MCCIA App Hub" };

/** IVR-CRM Admin opens inside the hub's own frame, with its own sidebar beside the pages, as Cabs Admin does. */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const [hubUser, user, unread, org] = await Promise.all([
    requireUser(),
    requireAdmin(),
    requireUser().then((u) => noticeUnread(u.id)),
    getOrgIntegration().catch(() => null),
  ]);
  return (
    <HubShell user={{ name: hubUser.name, role: hubUser.role }} unread={unread}>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <aside className="w-full shrink-0 lg:sticky lg:top-20 lg:w-64">
          <MobileMenu label="IVR-CRM Admin menu"><IvrSidebar section="admin" roles={user.roles} /></MobileMenu>
        </aside>
        <div className="page-slot min-w-0 flex-1">{children}</div>
      </div>
      <AutoSync initialLastSyncAt={org?.lastSyncAt?.toISOString() ?? null} />
    </HubShell>
  );
}
