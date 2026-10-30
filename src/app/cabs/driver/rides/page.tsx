import { DriverView } from "@/components/cabs/DriverView";
import { rideView } from "@/components/cabs/RideCard";
import { listRides } from "@/lib/cabs/bookings";
import { requireDriverPage } from "@/lib/cabs/guard";

export const metadata = { title: "My Rides · Cabs Driver · MCCIA App Hub" };

/** The driver's finished and cancelled rides, newest first. */
export default async function DriverHistoryPage() {
  const user = await requireDriverPage();
  const rides = user.driverId ? await listRides({ driverId: user.driverId, scope: "past" }) : [];
  return (
    <div className="page-enter space-y-5">
      <div><h1 className="text-2xl">My Rides</h1><p className="text-sm text-muted">Rides you have completed, and ones that were cancelled.</p></div>
      <DriverView rides={rides.map(rideView)} empty="No past rides yet." />
    </div>
  );
}
