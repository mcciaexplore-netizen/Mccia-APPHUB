import { DriverView } from "@/components/cabs/DriverView";
import { rideView } from "@/components/cabs/RideCard";
import { listRides } from "@/lib/cabs/bookings";
import { requireDriverPage } from "@/lib/cabs/guard";

/** The day in India, "YYYY-MM-DD". */
const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

/** Cabs Driver: today's rides (with Start and Complete), then the ones on later days. */
export default async function DriverDashboard() {
  const user = await requireDriverPage();
  const open = user.driverId ? await listRides({ driverId: user.driverId, scope: "open" }) : [];
  const today = istDay(new Date());
  // A ride already under way, or one from an earlier day not yet started, belongs with today's.
  const now = open.filter((r) => r.status === "in_progress" || istDay(r.scheduledFor) <= today);
  const later = open.filter((r) => !now.includes(r));
  return (
    <div className="page-enter space-y-6">
      <div><h1 className="text-2xl">Cabs Driver</h1><p className="text-sm text-muted">Your rides. Start one when you set off and complete it at the drop-off.</p></div>
      <section className="space-y-3"><h2 className="text-lg">Today</h2><DriverView rides={now.map(rideView)} empty="No rides today." /></section>
      <section className="space-y-3"><h2 className="text-lg">Upcoming</h2><DriverView rides={later.map(rideView)} empty="Nothing assigned for later days." /></section>
    </div>
  );
}
