import { AssignedList } from "@/components/cabs/DriverView";
import { rideView } from "@/components/cabs/RideCard";
import { listRides } from "@/lib/cabs/bookings";
import { requireDriverPage } from "@/lib/cabs/guard";

/** Assigned: the passengers the office has given this driver, soonest first, each with the OTP box for the pickup. */
export default async function AssignedPage() {
  const user = await requireDriverPage();
  const rides = user.driverId ? await listRides({ driverId: user.driverId, status: "assigned", scope: "open" }) : [];
  return (
    <div className="page-enter space-y-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-muted">Hi {user.name.split(/\s+/)[0]}</p>
        <h1 className="mt-1 text-2xl font-extrabold text-ink">Assigned passengers</h1>
        <p className="mt-1 text-sm text-muted">Passengers the office has assigned to you.</p>
      </div>
      <h2 className="flex items-center gap-2 text-base font-bold text-ink">Upcoming <span className="rounded-full bg-[#1a2b4a] px-2 py-0.5 text-xs text-white" data-upcoming-count>{rides.length}</span></h2>
      <AssignedList rides={rides.map(rideView)} />
    </div>
  );
}
