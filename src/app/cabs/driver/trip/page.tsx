import { TripView } from "@/components/cabs/DriverView";
import { rideView } from "@/components/cabs/RideCard";
import { listRides } from "@/lib/cabs/bookings";
import { requireDriverPage } from "@/lib/cabs/guard";

export const metadata = { title: "Trip · Cabs Driver · MCCIA App Hub" };

/** Trip: the ride under way now, with navigation and Complete Ride. */
export default async function TripPage() {
  const user = await requireDriverPage();
  const [ride] = user.driverId ? await listRides({ driverId: user.driverId, status: "in_progress" }, 1) : [];
  return (
    <div className="page-enter space-y-4">
      <h1 className="text-2xl font-extrabold text-ink">Trip</h1>
      <TripView ride={ride ? rideView(ride) : null} />
    </div>
  );
}
