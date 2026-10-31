import { HistoryList } from "@/components/cabs/DriverView";
import { rideView } from "@/components/cabs/RideCard";
import { listRides } from "@/lib/cabs/bookings";
import { viewedDriver } from "@/lib/cabs/drivers";
import { requireDriverPage } from "@/lib/cabs/guard";
import { AdminDriverPicker } from "@/components/cabs/AdminDriverPicker";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export const metadata = { title: "History · Cabs Driver · MCCIA App Hub" };

/** History: the driver's completed rides, newest first. */
export default async function DriverHistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireDriverPage();
  const view = await viewedDriver(user, one((await searchParams).driver));
  const rides = view.driverId ? await listRides({ driverId: view.driverId, status: "completed" }, 200) : [];
  const sorted = [...rides].sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
  return (
    <div className="page-enter space-y-4">
      <AdminDriverPicker user={user} view={view} />
      <h1 className="text-2xl font-extrabold text-ink">History</h1>
      <HistoryList rides={sorted.map((r) => ({ ...rideView(r), startedAt: r.startedAt?.toISOString() ?? null, completedAt: r.completedAt?.toISOString() ?? null }))} />
    </div>
  );
}
