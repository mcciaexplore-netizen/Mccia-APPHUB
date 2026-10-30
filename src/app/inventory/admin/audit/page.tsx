import Link from "next/link";
import { Download } from "lucide-react";
import { AUDIT_ACTIONS, AUDIT_PAGE_SIZE, detailsText, isAuditAction, listInventoryAudit } from "@/lib/inventory/audit";
import { requirePage } from "@/lib/inventory/guard";
import { listBranches } from "@/lib/inventory/host-adapter";
import { formatIST } from "@/lib/format";

export const metadata = { title: "Audit Log · Inventory · MCCIA App Hub" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const label = (action: string) => (isAuditAction(action) ? AUDIT_ACTIONS[action] : action);

/** Every important Inventory action, newest first, 50 to a page, with filters and a CSV export. Inventory admins only: anyone else gets "not found". */
export default async function InventoryAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePage("inventory_admin");
  const sp = await searchParams;
  const f = { branch: one(sp.branch), action: one(sp.action), from: one(sp.from), to: one(sp.to) };
  const [{ rows, total, page }, branches] = await Promise.all([
    listInventoryAudit({ branchId: f.branch, action: f.action, from: f.from, to: f.to }, Number(one(sp.page)) || 1),
    listBranches(),
  ]);
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  const query = (extra: Record<string, string>) => new URLSearchParams({ ...(f.branch && { branch: f.branch }), ...(f.action && { action: f.action }), ...(f.from && { from: f.from }), ...(f.to && { to: f.to }), ...extra }).toString();
  const pageHref = (p: number) => `/inventory/admin/audit?${query({ page: String(p) })}`;
  const filtered = !!(f.branch || f.action || f.from || f.to);
  return (
    <div className="page-enter space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Audit Log</h1>
          <p className="text-sm text-muted">Who did what in Inventory, and when: items, stock, transfers, requests and maintenance. {total} {total === 1 ? "entry" : "entries"}.</p>
        </div>
        <a href={`/api/inventory/audit/export?${query({})}`} className="btn btn-ghost btn-sm"><Download size={14} /> Export CSV</a>
      </div>
      <form className="flex flex-wrap items-end gap-3" method="get" action="/inventory/admin/audit">
        <label className="block"><span className="label-xs mb-1.5 block">Branch</span>
          <select name="branch" className="input !w-auto" defaultValue={f.branch}><option value="">All branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label className="block"><span className="label-xs mb-1.5 block">Action</span>
          <select name="action" className="input !w-auto" defaultValue={f.action}><option value="">All actions</option>{Object.entries(AUDIT_ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="block"><span className="label-xs mb-1.5 block">From</span><input type="date" name="from" className="input !w-auto" defaultValue={f.from} /></label>
        <label className="block"><span className="label-xs mb-1.5 block">To</span><input type="date" name="to" className="input !w-auto" defaultValue={f.to} /></label>
        <button className="btn btn-primary btn-sm">Show</button>
        {filtered && <Link href="/inventory/admin/audit" className="btn btn-ghost btn-sm">Clear</Link>}
      </form>
      <div className="table-wrap"><table>
        <thead><tr><th>Time</th><th>Who</th><th>Action</th><th>Item / Target</th><th>Branch</th><th>Details</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap text-xs text-muted">{formatIST(r.createdAt)}</td>
              <td>{r.actorName}</td>
              <td><span className="badge badge-neutral">{label(r.action)}</span></td>
              <td><b>{r.targetLabel}</b></td>
              <td>{r.branchName ?? <span className="text-subtle">—</span>}</td>
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
