import Link from "next/link";
import { Download } from "lucide-react";
import { AUDIT_ACTIONS, detailsText, isAuditAction, subjectOf, type AuditRow } from "@/lib/cabs/audit";
import { formatIST } from "@/lib/format";

const label = (action: string) => (isAuditAction(action) ? AUDIT_ACTIONS[action] : action);

/** The Cab Booking audit log: filters (a plain form), the CSV export with the same filters, the entries, and the pages. */
export function AuditView({ rows, total, page, pages, filters }: { rows: AuditRow[]; total: number; page: number; pages: number; filters: { action: string; from: string; to: string } }) {
  const f = filters;
  const query = (extra: Record<string, string>) => new URLSearchParams({ ...(f.action && { action: f.action }), ...(f.from && { from: f.from }), ...(f.to && { to: f.to }), ...extra }).toString();
  const pageHref = (p: number) => `/cabs/admin/audit?${query({ page: String(p) })}`;
  const filtered = !!(f.action || f.from || f.to);
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
        <button className="btn btn-primary btn-sm">Show</button>
        {filtered && <Link href="/cabs/admin/audit" className="btn btn-ghost btn-sm">Clear</Link>}
      </form>
      <div className="table-wrap"><table>
        <thead><tr><th>Time</th><th>Who</th><th>Action</th><th>About</th><th>Details</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap text-xs text-muted">{formatIST(r.createdAt)}</td>
              <td>{r.actorName}</td>
              <td><span className="badge badge-neutral">{label(r.action)}</span></td>
              <td><b>{subjectOf(r.details)}</b></td>
              <td className="max-w-md text-xs">{detailsText(r.details)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={5} className="text-subtle">{filtered ? "No entries match." : "Nothing recorded yet."}</td></tr>}
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
