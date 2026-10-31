import { FleetMap } from "@/components/cabs/FleetMap";
import { LiveTripsView } from "@/components/cabs/LiveTripsView";
import { listDrivers } from "@/lib/cabs/drivers";
import { requireAdminPage } from "@/lib/cabs/guard";

export const metadata = { title: "Live Trips · Cabs Admin · MCCIA App Hub" };

/** Every ride in progress, on the map and listed, refreshed every 5 seconds; below it, every driver's latest position (the fleet map). */
export default async function LiveTripsPage() {
  await requireAdminPage();
  const drivers = await listDrivers();
  return (
    <div className="page-enter space-y-5">
      <div><h1 className="text-2xl">Live Trips</h1><p className="text-sm text-muted">Rides under way now: where each driver is, who they are carrying, and for how long. Refreshes every 5 seconds.</p></div>
      <LiveTripsView />
      <section className="space-y-3" data-all-drivers>
        <div><h2 className="text-lg">All drivers</h2><p className="text-sm text-muted">Each driver&apos;s latest position from the last 24 hours, with availability.</p></div>
        <FleetMap drivers={drivers.map((d) => ({ id: d.id, name: d.name, isAvailable: d.isAvailable }))} />
      </section>
    </div>
  );
}
