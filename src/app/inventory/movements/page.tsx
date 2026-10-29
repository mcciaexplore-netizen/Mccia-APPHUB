import Link from "next/link";
import { listItems } from "@/lib/inventory/catalog";
import { requirePage } from "@/lib/inventory/guard";
import { MOVEMENT_KINDS, PAGE_SIZE, listMovements } from "@/lib/inventory/history";
import { formatIST } from "@/lib/format";

export const metadata = { title: "Stock movements · Inventory · MCCIA App Hub" };

const KIND: Record<string, { label: string; cls: string }> = {
  inward: { label: "Inward", cls: "badge badge-green" }, issue: { label: "Issue", cls: "badge badge-purple" }, return: { label: "Return", cls: "badge" },
  adjust: { label: "Adjust", cls: "badge badge-neutral" }, recount: { label: "Recount", cls: "badge badge-neutral" },
};
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Every change to stock, newest first, for store staff. Read only. */
export default async function MovementsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePage("inventory_staff", "inventory_admin");
  const sp = await searchParams;
  const f = { item: one(sp.item), kind: one(sp.kind), from: one(sp.from), to: one(sp.to), page: Number(one(sp.page)) || 1 };
  const [{ rows, total, page }, items] = await Promise.all([listMovements({ itemId: f.item, kind: f.kind, from: f.from, to: f.to, page: f.page }), listItems({ includeInactive: true })]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (p: number) => `/inventory/movements?${new URLSearchParams({ ...(f.item && { item: f.item }), ...(f.kind && { kind: f.kind }), ...(f.from && { from: f.from }), ...(f.to && { to: f.to }), page: String(p) })}`;
  return (
    <div className="page-enter space-y-5">
      <div>
        <h1 className="text-2xl">Stock movements</h1>
        <p className="text-sm text-muted">Every change to stock: goods in, issues, returns, adjustments and recounts. {total} {total === 1 ? "movement" : "movements"}.</p>
      </div>
      <form className="flex flex-wrap items-end gap-3" method="get" action="/inventory/movements">
        <label className="block"><span className="label-xs mb-1.5 block">Item</span>
          <select name="item" className="input !w-auto" defaultValue={f.item}><option value="">All items</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
        <label className="block"><span className="label-xs mb-1.5 block">Kind</span>
          <select name="kind" className="input !w-auto" defaultValue={f.kind}><option value="">All kinds</option>{MOVEMENT_KINDS.map((k) => <option key={k} value={k}>{KIND[k].label}</option>)}</select></label>
        <label className="block"><span className="label-xs mb-1.5 block">From</span><input type="date" name="from" className="input !w-auto" defaultValue={f.from} /></label>
        <label className="block"><span className="label-xs mb-1.5 block">To</span><input type="date" name="to" className="input !w-auto" defaultValue={f.to} /></label>
        <button className="btn btn-primary btn-sm">Show</button>
        {(f.item || f.kind || f.from || f.to) && <Link href="/inventory/movements" className="btn btn-ghost btn-sm">Clear</Link>}
      </form>
      <div className="table-wrap"><table>
        <thead><tr><th>When</th><th>Item</th><th>Kind</th><th className="text-right">Change</th><th className="text-right">After</th><th>Details</th><th>By</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap text-xs text-muted">{formatIST(r.createdAt)}</td>
              <td><b>{r.item}</b></td>
              <td><span className={KIND[r.kind]?.cls ?? "badge"}>{KIND[r.kind]?.label ?? r.kind}</span></td>
              <td className={`text-right font-semibold ${r.delta < 0 ? "text-brand-red" : "text-[var(--c-green-text)]"}`}>{r.delta > 0 ? `+${r.delta}` : r.delta}</td>
              <td className="text-right">{r.quantityAfter} {r.unit}</td>
              <td className="text-xs">
                {r.poId && r.poNo && <Link href={`/inventory/purchase-orders/${r.poId}`} className="mr-2 font-mono text-primary hover:underline">{r.poNo}</Link>}
                {r.requestId && <Link href="/inventory/requests?status=fulfilled" className="mr-2 text-primary hover:underline">Request by {r.requestedByName ?? "someone"}</Link>}
                {[r.issuedToName && `To ${r.issuedToName}`, r.eventName, r.vendor && `From ${r.vendor}`, r.challanNo && `Challan ${r.challanNo}`, r.reason].filter(Boolean).join(" · ")}
              </td>
              <td className="text-xs">{r.actorName}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={7} className="text-subtle">No stock movements match.</td></tr>}
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
