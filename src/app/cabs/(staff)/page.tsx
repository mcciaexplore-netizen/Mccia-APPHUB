import Link from "next/link";
import { Plus } from "lucide-react";
import { RideCard, rideView } from "@/components/cabs/RideCard";
import { RidesView } from "@/components/cabs/RidesView";
import { listRides } from "@/lib/cabs/bookings";
import { requireCabsPage } from "@/lib/cabs/guard";

/** MCCIA Cabs: the person's rides still to come (which they can cancel while pending), their last few, and Book a Ride. */
export default async function CabsDashboard() {
  const user = await requireCabsPage();
  const [upcoming, past] = await Promise.all([listRides({ requestedById: user.id, scope: "open", withOtp: true }), listRides({ requestedById: user.id, scope: "past" }, 3)]);
  return (
    <div className="page-enter space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl">MCCIA Cabs</h1><p className="text-sm text-muted">Book an office cab and follow it. A Cabs admin confirms each ride with a driver and a car.</p></div>
        <Link href="/cabs/book" className="btn btn-primary btn-sm"><Plus size={14} /> Book a Ride</Link>
      </div>
      <section className="space-y-3"><h2 className="text-lg">Upcoming rides</h2><RidesView rides={upcoming.map(rideView)} empty="Nothing booked. Book a ride when you need one." /></section>
      {past.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between"><h2 className="text-lg">Past rides</h2><Link href="/cabs/rides" className="text-sm text-primary">See all</Link></div>
          <div className="grid gap-3 md:grid-cols-2">{past.map((r) => <RideCard key={r.id} ride={rideView(r)} />)}</div>
        </section>
      )}
    </div>
  );
}
