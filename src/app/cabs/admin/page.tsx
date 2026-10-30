import Link from "next/link";
import { RideCard, rideView } from "@/components/cabs/RideCard";
import { adminStats, listRides } from "@/lib/cabs/bookings";
import { requireAdminPage } from "@/lib/cabs/guard";

/** Cabs Admin: rides waiting for a driver, today's rides, what is running now, and the fleet; then the oldest rides still waiting. */
export default async function CabsAdminDashboard() {
  await requireAdminPage();
  const [s, waiting] = await Promise.all([adminStats(), listRides({ status: "pending", scope: "open" }, 6)]);
  const tiles: [string, number, string, string?][] = [
    ["Waiting for a driver", s.pending, "/cabs/admin/rides?status=pending", s.pending ? "text-[#b45309]" : undefined],
    ["Today's rides", s.today, "/cabs/admin/rides"],
    ["Running now", s.inProgress, "/cabs/admin/rides?status=in_progress"],
    ["Active vehicles", s.vehicles, "/cabs/admin/vehicles"],
    ["Drivers available", s.available, "/cabs/admin/drivers"],
  ];
  return (
    <div className="page-enter space-y-6">
      <div><h1 className="text-2xl">Cabs Admin</h1><p className="text-sm text-muted">Assign drivers and cars to rides, and keep the fleet in order. {s.drivers} {s.drivers === 1 ? "driver" : "drivers"} in all.</p></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {tiles.map(([label, n, href, tone]) => (
          <Link key={label} href={href} className="glass glass-hover block p-4" data-stat={label}>
            <span className="label-xs block">{label}</span><span className={`mt-1 block text-3xl font-bold ${tone ?? "text-ink"}`}>{n}</span>
          </Link>
        ))}
      </div>
      <section className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="text-lg">Waiting for a driver</h2><Link href="/cabs/admin/rides?status=pending" className="text-sm text-primary">Assign on All Rides</Link></div>
        {waiting.length ? <div className="grid gap-3 md:grid-cols-2">{waiting.map((r) => <RideCard key={r.id} ride={rideView(r)} showRequester />)}</div> : <p className="text-sm text-subtle">No ride is waiting.</p>}
      </section>
    </div>
  );
}
