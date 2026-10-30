import Link from "next/link";
import { Download } from "lucide-react";
import { userActivity } from "@/lib/cabs/activity";
import { requireAdminPage } from "@/lib/cabs/guard";
import { rideBranches } from "@/lib/cabs/payments";
import { formatIST } from "@/lib/format";

export const metadata = { title: "User Activity · Cabs Admin · MCCIA App Hub" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Who books rides, and how often. A row opens that person's rides. */
export default async function UserActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const sp = await searchParams;
  const f = { branch: one(sp.branch), from: one(sp.from), to: one(sp.to), sort: one(sp.sort) === "name" ? ("name" as const) : ("total" as const) };
  const [rows, branches] = await Promise.all([userActivity(f), rideBranches()]);
  const query = new URLSearchParams({ ...(f.branch && { branch: f.branch }), ...(f.from && { from: f.from }), ...(f.to && { to: f.to }), ...(f.sort === "name" && { sort: "name" }) }).toString();
  const filtered = !!(f.branch || f.from || f.to);
  return (
    <div className="page-enter space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl">User Activity</h1><p className="text-sm text-muted">Rides booked by each person. {rows.length} {rows.length === 1 ? "person" : "people"}.</p></div>
        <a href={`/api/cabs/activity/export?${query}`} className="btn btn-ghost btn-sm"><Download size={14} /> Export CSV</a>
      </div>
      <form className="flex flex-wrap items-end gap-3" method="get" action="/cabs/admin/activity">
        <label className="block"><span className="label-xs mb-1.5 block">Branch</span>
          <select name="branch" className="input !w-auto" defaultValue={f.branch}><option value="">All</option>{branches.map((b) => <option key={b} value={b}>{b}</option>)}</select></label>
        <label className="block"><span className="label-xs mb-1.5 block">From</span><input type="date" name="from" className="input !w-auto" defaultValue={f.from} /></label>
        <label className="block"><span className="label-xs mb-1.5 block">To</span><input type="date" name="to" className="input !w-auto" defaultValue={f.to} /></label>
        <label className="block"><span className="label-xs mb-1.5 block">Sort by</span>
          <select name="sort" className="input !w-auto" defaultValue={f.sort}><option value="total">Total rides</option><option value="name">Name</option></select></label>
        <button className="btn btn-primary btn-sm">Show</button>
        {(filtered || f.sort === "name") && <Link href="/cabs/admin/activity" className="btn btn-ghost btn-sm">Clear</Link>}
      </form>
      <div className="table-wrap"><table>
        <thead><tr><th>User</th><th>Branch</th><th className="text-right">Total rides</th><th className="text-right">This month</th><th className="text-right">This week</th><th>Last ride</th><th>Most common pickup</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.userId} data-user-activity={r.userId}>
              <td><Link href={`/cabs/admin/rides?user=${r.userId}`} className="font-semibold text-primary hover:underline">{r.name}</Link></td>
              <td>{r.branch ?? <span className="text-subtle">—</span>}</td>
              <td className="text-right font-semibold">{r.total}</td>
              <td className="text-right">{r.month}</td>
              <td className="text-right">{r.week}</td>
              <td className="whitespace-nowrap text-xs text-muted">{r.lastRide ? formatIST(r.lastRide) : "—"}</td>
              <td>{r.commonPickup ?? <span className="text-subtle">—</span>}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="text-subtle">{filtered ? "Nobody matches." : "No rides booked yet."}</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}
