import Link from "next/link";
import { driverActivity } from "@/lib/cabs/activity";
import { requireAdminPage } from "@/lib/cabs/guard";
import { formatIST } from "@/lib/format";

export const metadata = { title: "Driver Activity · Cabs Admin · MCCIA App Hub" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const minutes = (m: number | null) => (m == null ? "—" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);

/** Each driver's completed rides and how long they take. A row opens that driver's completed rides. */
export default async function DriverActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const available = one(sp.available) === "yes" ? ("yes" as const) : one(sp.available) === "no" ? ("no" as const) : undefined;
  const f = { from: one(sp.from), to: one(sp.to), available };
  const rows = await driverActivity(f);
  const filtered = !!(f.from || f.to || f.available);
  return (
    <div className="page-enter space-y-5">
      <div><h1 className="text-2xl">Driver Activity</h1><p className="text-sm text-muted">Completed rides per driver{filtered ? " in the range chosen" : ""}, with this month and this week, and the average time from pickup to drop-off.</p></div>
      <form className="flex flex-wrap items-end gap-3" method="get" action="/cabs/admin/drivers/activity">
        <label className="block"><span className="label-xs mb-1.5 block">From</span><input type="date" name="from" className="input !w-auto" defaultValue={f.from} /></label>
        <label className="block"><span className="label-xs mb-1.5 block">To</span><input type="date" name="to" className="input !w-auto" defaultValue={f.to} /></label>
        <label className="block"><span className="label-xs mb-1.5 block">Availability</span>
          <select name="available" className="input !w-auto" defaultValue={f.available ?? ""}><option value="">All</option><option value="yes">Available</option><option value="no">Unavailable</option></select></label>
        <button className="btn btn-primary btn-sm">Show</button>
        {filtered && <Link href="/cabs/admin/drivers/activity" className="btn btn-ghost btn-sm">Clear</Link>}
      </form>
      <div className="table-wrap"><table>
        <thead><tr><th>Driver</th><th>Phone</th><th>Vehicle</th><th className="text-right">Completed</th><th className="text-right">This month</th><th className="text-right">This week</th><th>Avg ride</th><th>Available</th><th>Last active</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.driverId} data-driver-activity={r.driverId}>
              <td><Link href={`/cabs/admin/rides?driver=${r.driverId}&status=completed`} className="font-semibold text-primary hover:underline">{r.name}</Link></td>
              <td className="whitespace-nowrap">{r.phone}</td>
              <td>{r.vehiclePlate ?? <span className="text-subtle">—</span>}</td>
              <td className="text-right font-semibold">{r.completed}</td>
              <td className="text-right">{r.month}</td>
              <td className="text-right">{r.week}</td>
              <td>{minutes(r.avgMinutes)}</td>
              <td>{r.isAvailable ? <span className="badge badge-green">Available</span> : <span className="badge badge-neutral">Unavailable</span>}</td>
              <td className="whitespace-nowrap text-xs text-muted">{r.lastActive ? formatIST(r.lastActive) : "—"}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={9} className="text-subtle">{filtered ? "No drivers match." : "No drivers yet."}</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}
