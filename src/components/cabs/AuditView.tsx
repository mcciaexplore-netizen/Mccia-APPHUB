import Link from "next/link";
import { Download } from "lucide-react";
import { AUDIT_ACTIONS, detailsText, isAuditAction, subjectOf, type AuditRow } from "@/lib/cabs/audit";
import { formatIST } from "@/lib/format";

const label = (action: string) => (isAuditAction(action) ? AUDIT_ACTIONS[action] : action);

type Filters = { action: string; from: string; to: string; actor: string; ride: string };

/**
 * The Cab Booking audit log: filters (a plain form: action, dates, who, ride), the CSV export with the same filters, the entries, and the
 * pages. A ride's short id filters to that ride.
 */
export function AuditView({ rows, total, page, pages, filters, actors }: { rows: AuditRow[]; total: number; page: number; pages: number; filters: Filters; actors: { id: string; name: string }[] }) {
  const f = filters;
  const query = (extra: Record<string, string>) => new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), ...extra }).toString();
  const pageHref = (p: number) => `/cabs/admin/audit?${query({ page: String(p) })}`;
  const filtered = Object.values(f).some(Boolean);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Audit Log</h1>
          <p className="text-sm text-muted">Who did what in Cab Booking, and when: rides, drivers and vehicles. {total} {total === 1 ? "entry" : "entries"}.</p>
        </div>
        <a href={`/api/cabs/audit/export?${query({})}`} className="btn btn-ghost btn-sm"><Download size={14} /> Export CSV</a>
      </div>
      <form className="flex flex-wrap items-end gap-3" method="get" action="/cabs/admin/audit">
        <label className="block"><span className="label-xs mb-1.5 block">Action</span>
          <select name="action" className="input !w-auto" defaultValue={f.action}><option value="">All actions</option>{Object.entries(AUDIT_ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="block"><span className="label-xs mb-1.5 block">From</span><input type="date" name="from" className="input !w-auto" defaultValue={f.from} /></label>
        <label className="block"><span className="label-xs mb-1.5 block">To</span><input type="date" name="to" className="input !w-auto" defaultValue={f.to} /></label>
        <label className="block"><span className="label-xs mb-1.5 block">Who</span>
          <select name="actor" className="input !w-auto" defaultValue={f.actor}><option value="">Anyone</option>{actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label className="block"><span className="label-xs mb-1.5 block">Ride ID</span>
          <input name="ride" className="input !w-36 font-mono" defaultValue={f.ride} placeholder="e.g. 3f2a9c1b" maxLength={36} /></label>
        <button className="btn btn-primary btn-sm">Show</button>
        {filtered && <Link href="/cabs/admin/audit" className="btn btn-ghost btn-sm">Clear</Link>}
      </form>
      <div className="table-wrap"><table>
        <thead><tr><th>Time</th><th>Who</th><th>Action</th><th>About</th><th>Ride</th><th>Details</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap text-xs text-muted">{formatIST(r.createdAt)}</td>
              <td>{r.actorName}</td>
              <td><span className="badge badge-neutral">{label(r.action)}</span></td>
              <td><b>{subjectOf(r.details)}</b></td>
              <td>{r.rideId ? <Link href={`/cabs/admin/audit?ride=${r.rideId}`} className="font-mono text-xs text-primary hover:underline" title="Show only this ride" data-ride-link>{r.rideId.slice(0, 8)}</Link> : <span className="text-subtle">—</span>}</td>
              <td className="max-w-md text-xs">{detailsText(r.details)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="text-subtle">{filtered ? "No entries match." : "Nothing recorded yet."}</td></tr>}
        </tbody>
      </table></div>
      {pages > 1 && (
        <nav className="flex items-center gap-3 text-sm" aria-label="Pages">
          {page > 1 && <Link href={pageHref(page - 1)} className="btn btn-ghost btn-sm">Newer</Link>}
          <span className="text-muted">Page {page} of {pages}</span>
          {page < pages && <Link href={pageHref(page + 1)} className="btn btn-ghost btn-sm">Older</Link>}
        </nav>
      )}
    </div>
  );
}
