import { ConfirmProvider } from "@/components/ConfirmDialog";
import { CabsTopBar } from "@/components/cabs/CabsShell";
import { CabsDriverSidebar } from "@/components/cabs/DriverSidebar";
import { LocationSharer } from "@/components/cabs/LocationSharer";
import { OnlineToggle } from "@/components/cabs/OnlineToggle";
import { listRides } from "@/lib/cabs/bookings";
import { requireDriverPage } from "@/lib/cabs/guard";
import { requireUser } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cabs Driver · MCCIA App Hub" };

/**
 * The driver app, built for a phone (480 px wide, centred on a bigger screen): a top bar with the Online/Offline switch, the page, and four
 * tabs along the bottom. While a ride is under way, the phone's position is shared from here, so it keeps going between tabs. A Cabs admin
 * who is not a driver sees it without the switch.
 */
export default async function Layout({ children }: { children: React.ReactNode }) {
  const [, user] = await Promise.all([requireUser(), requireDriverPage()]);
  const [running] = user.driverId ? await listRides({ driverId: user.driverId, status: "in_progress" }, 1) : [];
  return (
    <ConfirmProvider>
      <div className="min-h-dvh bg-[#f0f2f5]">
        <CabsTopBar narrow label="Driver" right={user.driverId ? <OnlineToggle online={!!user.driverAvailable} /> : <span className="text-xs font-semibold text-muted">Admin view</span>} />
        <main className="page-slot mx-auto max-w-[480px] space-y-4 px-4 pb-28 pt-5">
          {running && <LocationSharer rideId={running.id} />}
          {children}
        </main>
        <CabsDriverSidebar roles={user.roles} />
      </div>
    </ConfirmProvider>
  );
}
