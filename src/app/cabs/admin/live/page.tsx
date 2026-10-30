import { LiveTripsView } from "@/components/cabs/LiveTripsView";
import { requireAdminPage } from "@/lib/cabs/guard";

export const metadata = { title: "Live Trips · Cabs Admin · MCCIA App Hub" };

/** Every ride in progress, on the map and listed, refreshed every 5 seconds. */
export default async function LiveTripsPage() {
  await requireAdminPage();
  return (
    <div className="page-enter space-y-5">
      <div><h1 className="text-2xl">Live Trips</h1><p className="text-sm text-muted">Rides under way now: where each driver is, who they are carrying, and for how long. Refreshes every 5 seconds.</p></div>
      <LiveTripsView />
    </div>
  );
}
