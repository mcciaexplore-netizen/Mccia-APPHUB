import Link from "next/link";
import { Hourglass, Radio } from "lucide-react";
import { RideCard, rideView } from "@/components/cabs/RideCard";
import { adminStats, pendingRides } from "@/lib/cabs/bookings";
import { requireAdminPage } from "@/lib/cabs/guard";

/** Cabs Admin: the figures (pending, active, completed today, drivers available), the ways to Pending Requests and Live Trips, then the longest-waiting rides. */
export default async function CabsAdminDashboard() {
  await requireAdminPage();
  const [s, waiting] = await Promise.all([adminStats(), pendingRides(6)]);
  const tiles: [string, number, string, string?][] = [
    ["Pending rides", s.pending, "/cabs/admin/pending", s.pending ? "text-[#b45309]" : undefined],
    ["Active trips", s.inProgress, "/cabs/admin/live"],
    ["Today's completed", s.completedToday, "/cabs/admin/trips?status=completed"],
    ["Available drivers", s.available, "/cabs/admin/drivers"],
  ];
  return (
    <div className="page-enter space-y-6">
      <div><h1 className="text-2xl">Cabs Admin</h1><p className="text-sm text-muted">Assign drivers and cars to rides, and keep the fleet in order. {s.drivers} {s.drivers === 1 ? "driver" : "drivers"} and {s.vehicles} active {s.vehicles === 1 ? "vehicle" : "vehicles"} in all.</p></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map(([label, n, href, tone]) => (
          <Link key={label} href={href} className="glass glass-hover block p-4" data-stat={label}>
            <span className="label-xs block">{label}</span><span className={`mt-1 block text-3xl font-bold ${tone ?? "text-ink"}`}>{n}</span>
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href="/cabs/admin/pending" className="btn btn-primary" data-quick="pending"><Hourglass size={16} /> View Pending ({s.pending})</Link>
        <Link href="/cabs/admin/live" className="btn btn-ghost" data-quick="live"><Radio size={16} /> View Live Trips</Link>
      </div>
      <section className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="text-lg">Waiting longest</h2><Link href="/cabs/admin/pending" className="text-sm text-primary">All pending requests</Link></div>
        {waiting.length ? <div className="grid gap-3 md:grid-cols-2">{waiting.map((r) => <RideCard key={r.id} ride={rideView(r)} showRequester />)}</div> : <p className="text-sm text-subtle">No ride is waiting.</p>}
      </section>
    </div>
  );
}
