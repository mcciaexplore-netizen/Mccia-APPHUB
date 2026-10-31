import { AdminDriverPicker } from "@/components/cabs/AdminDriverPicker";
import { AssignedList } from "@/components/cabs/DriverView";
import { rideView } from "@/components/cabs/RideCard";
import { listRides } from "@/lib/cabs/bookings";
import { viewedDriver } from "@/lib/cabs/drivers";
import { requireDriverPage } from "@/lib/cabs/guard";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Assigned: the passengers the office has given this driver, soonest first, each with the OTP box for the pickup. A Cabs admin can pick a
 * driver to see this as they would (read-only).
 */
export default async function AssignedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireDriverPage();
  const view = await viewedDriver(user, one((await searchParams).driver));
  const rides = view.driverId ? await listRides({ driverId: view.driverId, status: "assigned", scope: "open" }) : [];
  return (
    <div className="page-enter space-y-4">
      <AdminDriverPicker user={user} view={view} />
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-muted">Hi {view.name.split(/\s+/)[0]}</p>
        <h1 className="mt-1 text-2xl font-extrabold text-ink">Assigned passengers</h1>
        <p className="mt-1 text-sm text-muted">{view.preview ? `Passengers the office has assigned to ${view.name}.` : "Passengers the office has assigned to you."}</p>
      </div>
      <h2 className="flex items-center gap-2 text-base font-bold text-ink">Upcoming <span className="rounded-full bg-[#1a2b4a] px-2 py-0.5 text-xs text-white" data-upcoming-count>{rides.length}</span></h2>
      <AssignedList rides={rides.map(rideView)} preview={view.preview} />
    </div>
  );
}
