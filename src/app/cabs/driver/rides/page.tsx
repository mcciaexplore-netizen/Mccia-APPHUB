import { HistoryList } from "@/components/cabs/DriverView";
import { rideView } from "@/components/cabs/RideCard";
import { listRides } from "@/lib/cabs/bookings";
import { requireDriverPage } from "@/lib/cabs/guard";

export const metadata = { title: "History · Cabs Driver · MCCIA App Hub" };

/** History: the driver's completed rides, newest first. */
export default async function DriverHistoryPage() {
  const user = await requireDriverPage();
  const rides = user.driverId ? await listRides({ driverId: user.driverId, status: "completed" }, 200) : [];
  const sorted = [...rides].sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
  return (
    <div className="page-enter space-y-4">
      <h1 className="text-2xl font-extrabold text-ink">History</h1>
      <HistoryList rides={sorted.map((r) => ({ ...rideView(r), startedAt: r.startedAt?.toISOString() ?? null, completedAt: r.completedAt?.toISOString() ?? null }))} />
    </div>
  );
}
