import { rideView } from "@/components/cabs/RideCard";
import { RidesView } from "@/components/cabs/RidesView";
import { listRides } from "@/lib/cabs/bookings";
import { requireCabsPage } from "@/lib/cabs/guard";

export const metadata = { title: "My Rides · MCCIA Cabs · MCCIA App Hub" };

/** Every ride the person has booked, newest first, with its status. */
export default async function MyRidesPage() {
  const user = await requireCabsPage();
  const rides = await listRides({ requestedById: user.id });
  return (
    <div className="page-enter space-y-5">
      <div><h1 className="text-2xl">My Rides</h1><p className="text-sm text-muted">{rides.length} {rides.length === 1 ? "ride" : "rides"}. A pending ride can be cancelled.</p></div>
      <RidesView rides={rides.map(rideView)} empty="You haven't booked a ride yet." />
    </div>
  );
}
