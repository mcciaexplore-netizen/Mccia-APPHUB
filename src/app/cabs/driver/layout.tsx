import { Suspense } from "react";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { CabsTopBar } from "@/components/cabs/CabsShell";
import { CabsDriverSidebar } from "@/components/cabs/DriverSidebar";
import { LocationSharer } from "@/components/cabs/LocationSharer";
import { OnlineToggle } from "@/components/cabs/OnlineToggle";
import { listRides } from "@/lib/cabs/bookings";
import { HubBell } from "@/components/HubBell";
import { requireDriverPage } from "@/lib/cabs/guard";
import { noticeUnread } from "@/lib/notice-feed";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cabs Driver · MCCIA App Hub" };

/**
 * The driver app, built for a phone (480 px wide, centred on a bigger screen): a top bar with the Online/Offline switch, the page, and four
 * tabs along the bottom. While a ride is under way, the phone's position is shared from here, so it keeps going between tabs. A Cabs admin
 * who is not a driver sees it without the switch. Opened by a driver signed in by phone, a Cabs admin, or someone signed in to the hub
 * with a driver's email; anyone else goes to /cabs/driver-login.
 */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const user = await requireDriverPage();
  // A driver signed in by phone has no hub account, so no bell; someone signed in to the hub gets the hub's bell here too.
  const [[running], unread] = await Promise.all([
    user.driverId ? listRides({ driverId: user.driverId, status: "in_progress" }, 1) : Promise.resolve([]),
    user.via === "hub" ? noticeUnread(user.id) : Promise.resolve(null),
  ]);
  const status = user.driverId ? <OnlineToggle online={!!user.driverAvailable} /> : <span className="text-xs font-semibold text-muted">Admin view</span>;
  return (
    <ConfirmProvider>
      <div className="min-h-dvh bg-[#f0f2f5]">
        <CabsTopBar narrow label="Driver" hubLink={user.via === "hub"} right={unread === null ? status : <div className="flex items-center gap-2"><HubBell unread={unread} />{status}</div>} />
        <main className="page-slot mx-auto max-w-[480px] space-y-4 px-4 pb-28 pt-5">
          {running && <LocationSharer rideId={running.id} />}
          {children}
        </main>
        <Suspense fallback={null}><CabsDriverSidebar roles={user.roles} /></Suspense>
      </div>
    </ConfirmProvider>
  );
}
