import { TripView } from "@/components/cabs/DriverView";
import { rideView } from "@/components/cabs/RideCard";
import { listRides } from "@/lib/cabs/bookings";
import { viewedDriver } from "@/lib/cabs/drivers";
import { requireDriverPage } from "@/lib/cabs/guard";
import { AdminDriverPicker } from "@/components/cabs/AdminDriverPicker";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export const metadata = { title: "Trip · Cabs Driver · MCCIA App Hub" };

/** Trip: the ride under way now, with navigation and Complete Ride. */
export default async function TripPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireDriverPage();
  const view = await viewedDriver(user, one((await searchParams).driver));
  const [ride] = view.driverId ? await listRides({ driverId: view.driverId, status: "in_progress" }, 1) : [];
  return (
    <div className="page-enter space-y-4">
      <AdminDriverPicker user={user} view={view} />
      <h1 className="text-2xl font-extrabold text-ink">Trip</h1>
      <TripView ride={ride ? rideView(ride) : null} preview={view.preview} />
    </div>
  );
}
