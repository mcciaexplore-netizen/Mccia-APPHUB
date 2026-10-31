import Link from "next/link";
import { AdminRidesView } from "@/components/cabs/AdminRidesView";
import { rideView } from "@/components/cabs/RideCard";
import { availableDrivers, listRides } from "@/lib/cabs/bookings";
import { RIDE_STATUSES, RIDE_STATUS_LABEL, type RideStatus } from "@/lib/cabs/cabs.manifest";
import { listDrivers } from "@/lib/cabs/drivers";
import { requireAdminPage } from "@/lib/cabs/guard";
import { listBranchNames } from "@/lib/cabs/host-adapter";
import { activeVehicles } from "@/lib/cabs/vehicles";

export const metadata = { title: "All Trips · Cabs Admin · MCCIA App Hub" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** All Trips: every ride, filtered by status, scheduled date, driver and branch: assign the pending ones, cancel with a reason. */
export default async function AdminRidesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const f = { status: one(sp.status), from: one(sp.from), to: one(sp.to), driver: one(sp.driver), branch: one(sp.branch), user: one(sp.user) };
  const userId = /^[0-9a-f-]{36}$/i.test(f.user) ? f.user : undefined;
  const status = (RIDE_STATUSES as string[]).includes(f.status) ? (f.status as RideStatus) : undefined;
  const [rides, drivers, allDrivers, vehicles, branches] = await Promise.all([
    listRides({ status, from: f.from, to: f.to, driverId: /^[0-9a-f-]{36}$/i.test(f.driver) ? f.driver : undefined, branch: f.branch || undefined, requestedById: userId }, 500),
    availableDrivers(), listDrivers(), activeVehicles(), listBranchNames(),
  ]);
  const filtered = Object.values(f).some(Boolean);
  return (
    <div className="page-enter space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl">All Trips</h1><p className="text-sm text-muted">{rides.length} {rides.length === 1 ? "trip" : "trips"}{filtered ? " match" : ""}{userId && rides[0] ? ` booked by ${rides[0].requestedByName}` : ""}, latest first.</p></div>
        <Link href="/cabs/admin/activity" className="text-sm font-semibold text-primary" data-user-activity-link>User Activity →</Link>
      </div>
      <form className="flex flex-wrap items-end gap-3" method="get" action="/cabs/admin/trips">
        <label className="block"><span className="label-xs mb-1.5 block">Status</span>
          <select name="status" className="input !w-auto" defaultValue={f.status}><option value="">All</option>{RIDE_STATUSES.map((s) => <option key={s} value={s}>{RIDE_STATUS_LABEL[s]}</option>)}</select></label>
        <label className="block"><span className="label-xs mb-1.5 block">From</span><input type="date" name="from" className="input !w-auto" defaultValue={f.from} /></label>
        <label className="block"><span className="label-xs mb-1.5 block">To</span><input type="date" name="to" className="input !w-auto" defaultValue={f.to} /></label>
        <label className="block"><span className="label-xs mb-1.5 block">Driver</span>
          <select name="driver" className="input !w-auto" defaultValue={f.driver}><option value="">Any</option>{allDrivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label className="block"><span className="label-xs mb-1.5 block">Branch</span>
          <select name="branch" className="input !w-auto" defaultValue={f.branch}><option value="">Any</option>{branches.map((b) => <option key={b} value={b}>{b}</option>)}</select></label>
        {userId && <input type="hidden" name="user" value={userId} />}
        <button className="btn btn-primary btn-sm">Show</button>
        {filtered && <Link href="/cabs/admin/trips" className="btn btn-ghost btn-sm">Clear</Link>}
      </form>
      <AdminRidesView rides={rides.map(rideView)} drivers={drivers} vehicles={vehicles} empty={filtered ? "No trips match." : "No trips yet."} />
    </div>
  );
}
