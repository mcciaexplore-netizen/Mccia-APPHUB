import { RideQueueView } from "@/components/cabs/RideQueueView";
import { rideView } from "@/components/cabs/RideCard";
import { availableDrivers, pendingRides } from "@/lib/cabs/bookings";
import { requireAdminPage } from "@/lib/cabs/guard";
import { serverNow } from "@/lib/cabs/validation";
import { activeVehicles } from "@/lib/cabs/vehicles";

export const metadata = { title: "Pending Requests · Cabs Admin · MCCIA App Hub" };

/** Pending Requests: rides waiting for a driver, the longest-waiting first, to assign (driver and car) or cancel with a reason. */
export default async function PendingPage() {
  await requireAdminPage();
  const [rides, drivers, vehicles] = await Promise.all([pendingRides(), availableDrivers(), activeVehicles()]);
  return (
    <div className="page-enter space-y-5">
      <div><h1 className="text-2xl">Pending Requests</h1><p className="text-sm text-muted">{rides.length} {rides.length === 1 ? "ride is" : "rides are"} waiting for a driver, the longest-waiting first.</p></div>
      <RideQueueView mode="pending" rides={rides.map(rideView)} drivers={drivers} vehicles={vehicles} now={serverNow()} />
    </div>
  );
}
