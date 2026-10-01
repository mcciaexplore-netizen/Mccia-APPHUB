import Link from "next/link";
import { Download, UserX } from "lucide-react";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { apps, departments } from "@/db/schema";
import { getActivity, getMetrics, lastLogins, neverLaunched, type Filters } from "@/lib/activity";
import { formatIST } from "@/lib/format";
import { CountUp } from "@/components/CountUp";

function Kpi({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="glass glass-hover !rounded-md p-5 text-center">
      {children}<p className="label-xs mt-2">{label}</p>
    </div>
  );
}

/** Shared by the head-admin log and the dept-lead scoped log. */
export async function ActivityView({ filters, basePath, scopeDeptId, isAdmin, searchParams }: {
  filters: Filters; basePath: string; scopeDeptId?: string; isAdmin: boolean; searchParams: Record<string, string | string[] | undefined>;
}) {
  const [data, m, deps, appList, never, logins] = await Promise.all([
    getActivity(filters, scopeDeptId),
    getMetrics(scopeDeptId),
    db.select({ id: departments.id, name: departments.name }).from(departments).orderBy(asc(departments.name)),
    scopeDeptId
      ? db.select({ id: apps.id, name: apps.name }).from(apps).where(eq(apps.departmentId, scopeDeptId)).orderBy(asc(apps.name))
      : db.select({ id: apps.id, name: apps.name }).from(apps).orderBy(asc(apps.name)),
    isAdmin ? neverLaunched() : Promise.resolve([]),
    isAdmin ? lastLogins() : Promise.resolve([]),
  ]);

  const qs = (over: Record<string, string | number>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (typeof v === "string" && v) p.set(k, v);
    for (const [k, v] of Object.entries(over)) p.set(k, String(v));
    return p.toString();
  };
  const exportQs = new URLSearchParams(Object.entries(searchParams).filter(([k, v]) => typeof v === "string" && k !== "page") as [string, string][]).toString();

  return (
    <div className="space-y-10">
      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Active users this week"><CountUp value={m.activeUsersWeek} className="big-number" /></Kpi>
        <Kpi label="App launches today"><CountUp value={m.launchesToday} className="big-number big-number-green" /></Kpi>
        <Kpi label="Most used app this week">
          {m.topApp ? (<><p className="big-number !text-2xl">{m.topApp.name}</p><p className="text-sm text-brand-green-text"><CountUp value={m.topApp.n} /> launches</p></>) : <p className="big-number !text-2xl">—</p>}
        </Kpi>
      </div>

      <form method="get" className="glass !rounded-md grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6" action={basePath}>
        <label><span className="label-xs mb-1 block">Range</span>
          <select name="range" defaultValue={filters.range} className="input">
            <option value="today">Today</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="custom">Custom</option>
          </select></label>
        <label><span className="label-xs mb-1 block">From</span><input type="date" name="from" defaultValue={filters.from} className="input" /></label>
        <label><span className="label-xs mb-1 block">To</span><input type="date" name="to" defaultValue={filters.to} className="input" /></label>
        {!scopeDeptId && (
          <label><span className="label-xs mb-1 block">Department</span>
            <select name="dept" defaultValue={filters.departmentId ?? ""} className="input"><option value="">All</option>{deps.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        )}
        <label><span className="label-xs mb-1 block">Action</span>
          <select name="action" defaultValue={filters.action ?? ""} className="input"><option value="">All</option><option value="login">Login</option><option value="launch">App launch</option></select></label>
        <label><span className="label-xs mb-1 block">Application</span>
          <select name="app" defaultValue={filters.appId ?? ""} className="input"><option value="">All</option>{appList.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6">
          <button className="btn btn-primary btn-sm">Apply</button>
          <Link href={basePath} className="btn btn-ghost btn-sm">Reset</Link>
          {isAdmin && <a href={`${basePath}/export?${exportQs}`} className="btn btn-ghost btn-sm ml-auto"><Download size={14} /> Export CSV</a>}
        </div>
      </form>

      <section>
        <h2 className="mb-3 text-xl">Activity <span className="label-xs ml-2">{data.total.toLocaleString("en-IN")} in range</span></h2>
        <div className="table-wrap"><table>
          <thead><tr><th>User</th><th>Action</th><th>Application</th><th>Department</th><th>Time (IST)</th></tr></thead>
          <tbody>
            {data.rows.map((r) => (<tr key={r.id}><td>{r.user ? <><b>{r.user}</b><span className="block text-xs text-muted">{r.email}</span></> : <span className="text-subtle">Unknown</span>}</td><td><span className={`badge ${r.action === "login" ? "badge-neutral" : "badge-green"}`}>{r.action === "login" ? "Login" : "Launch"}</span></td><td>{r.action === "login" ? <span className="text-subtle">—</span> : (r.app ?? <span className="text-subtle">Deleted application</span>)}</td><td>{r.department ?? <span className="text-subtle">—</span>}</td><td className="whitespace-nowrap">{formatIST(r.openedAt)}</td></tr>))}
            {data.rows.length === 0 && <tr><td colSpan={5} className="text-subtle">No activity for these filters.</td></tr>}
          </tbody>
        </table></div>
        <div className="mt-4 flex items-center justify-between text-sm text-muted">
          <span>Page {filters.page} of {data.pages}</span>
          <div className="flex gap-2">
            {filters.page > 1 && <Link className="btn btn-ghost btn-sm" href={`${basePath}?${qs({ page: filters.page - 1 })}`}>Previous</Link>}
            {filters.page < data.pages && <Link className="btn btn-ghost btn-sm" href={`${basePath}?${qs({ page: filters.page + 1 })}`}>Next</Link>}
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section><h2 className="mb-3 text-xl">Launches per app</h2>
          <div className="table-wrap"><table><thead><tr><th>Application</th><th className="text-right">Launches</th></tr></thead>
            <tbody>{data.perApp.map((r, i) => <tr key={i}><td>{r.name ?? <span className="text-subtle">Deleted application</span>}</td><td className="text-right">{r.n.toLocaleString("en-IN")}</td></tr>)}
              {data.perApp.length === 0 && <tr><td colSpan={2} className="text-subtle">No data.</td></tr>}</tbody></table></div></section>
        <section><h2 className="mb-3 text-xl">Launches per department</h2>
          <div className="table-wrap"><table><thead><tr><th>Department</th><th className="text-right">Launches</th></tr></thead>
            <tbody>{data.perDept.map((r, i) => <tr key={i}><td>{r.name}</td><td className="text-right">{r.n.toLocaleString("en-IN")}</td></tr>)}
              {data.perDept.length === 0 && <tr><td colSpan={2} className="text-subtle">No data.</td></tr>}</tbody></table></div></section>
      </div>

      {isAdmin && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-xl"><UserX size={18} /> Never launched an app</h2>
            {never.length === 0 ? <div className="alert alert-green">Every active user has opened at least one application.</div> : (
              <div className="table-wrap"><table><thead><tr><th>User</th><th>Last login</th></tr></thead>
                <tbody>{never.map((u) => <tr key={u.id}><td><b>{u.name}</b><span className="block text-xs text-muted">{u.email}</span></td><td className="whitespace-nowrap text-xs">{formatIST(u.lastLoginAt)}</td></tr>)}</tbody></table></div>
            )}
          </section>
          <section>
            <h2 className="mb-3 text-xl">Last login per user</h2>
            <div className="table-wrap"><table><thead><tr><th>User</th><th>Last login</th></tr></thead>
              <tbody>{logins.map((u) => <tr key={u.id} className={u.isActive ? "" : "opacity-60"}><td><b>{u.name}</b><span className="block text-xs text-muted">{u.email}</span></td><td className="whitespace-nowrap text-xs">{formatIST(u.lastLoginAt)}</td></tr>)}
                {logins.length === 0 && <tr><td colSpan={2} className="text-subtle">No users.</td></tr>}</tbody></table></div>
          </section>
        </div>
      )}
    </div>
  );
}
