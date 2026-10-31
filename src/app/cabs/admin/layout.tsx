import "leaflet/dist/leaflet.css"; // the maps on Live Trips
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { HubShell } from "@/components/HubShell";
import { MobileMenu } from "@/components/MobileMenu";
import { CabsAdminSidebar } from "@/components/cabs/AdminSidebar";
import { requireAdminPage } from "@/lib/cabs/guard";
import { adminBadges } from "@/lib/cabs/bookings";
import { noticeUnread } from "@/lib/notice-feed";
import { requireUser } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cabs Admin · MCCIA App Hub" };

/** Cabs Admin opens inside the hub's own frame (its top bar), with its own sidebar beside the pages, the same way Inventory does. */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const [hubUser, user] = await Promise.all([requireUser(), requireAdminPage()]);
  // The sidebar's badges, worked out on each page load (Live Trips itself refreshes every 5 seconds), and the hub bell's count.
  const [badges, unread] = await Promise.all([adminBadges(), noticeUnread(hubUser.id)]);
  return (
    <HubShell user={{ name: hubUser.name, role: hubUser.role }} unread={unread}>
      <ConfirmProvider>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <aside className="w-full shrink-0 lg:sticky lg:top-20 lg:w-64">
            <MobileMenu label="Cabs Admin menu"><CabsAdminSidebar roles={user.roles} badges={badges} /></MobileMenu>
          </aside>
          <div className="page-slot min-w-0 flex-1">{children}</div>
        </div>
      </ConfirmProvider>
    </HubShell>
  );
}
