import { rideView } from "@/components/cabs/RideCard";
import { RidesView } from "@/components/cabs/RidesView";
import { listRides } from "@/lib/cabs/bookings";
import { requireCabsPage } from "@/lib/cabs/guard";

export const metadata = { title: "My rides · MCCIA Cabs · MCCIA App Hub" };

/** The person's rides: those still to come (with the OTP to show the driver once assigned), then past ones. */
export default async function MyRidesPage() {
  const user = await requireCabsPage();
  const [upcoming, past] = await Promise.all([
    listRides({ requestedById: user.id, scope: "open", withOtp: true }),
    listRides({ requestedById: user.id, scope: "past" }, 100),
  ]);
  return (
    <div className="page-enter space-y-6">
      <div><h1 className="text-3xl font-extrabold text-ink">My rides</h1><p className="mt-1 text-sm text-muted">A pending request can be cancelled.</p></div>
      <section className="space-y-3"><h2 className="text-lg font-bold text-ink">Upcoming</h2><RidesView rides={upcoming.map(rideView)} empty="Nothing booked. Book a ride when you need one." /></section>
      <section className="space-y-3"><h2 className="text-lg font-bold text-ink">Past</h2><RidesView rides={past.map(rideView)} empty="No past rides yet." /></section>
    </div>
  );
}
