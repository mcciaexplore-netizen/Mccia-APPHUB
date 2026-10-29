import Link from "next/link";
import { formatRupees } from "@/lib/inventory/format";
import { requirePage } from "@/lib/inventory/guard";
import { listInward } from "@/lib/inventory/history";
import { listVendors } from "@/lib/inventory/vendors";
import { formatIST } from "@/lib/format";

export const metadata = { title: "Purchases · Inventory · MCCIA App Hub" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Goods that came into stock (inward movements), with vendor, PO, challan and rate, for store staff. Read only. */
export default async function PurchasesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePage("inventory_staff", "inventory_admin");
  const sp = await searchParams;
  const f = { vendor: one(sp.vendor), from: one(sp.from), to: one(sp.to) };
  const [{ rows, totalPaise, capped }, vendors] = await Promise.all([listInward({ vendorId: f.vendor, from: f.from, to: f.to }), listVendors({ includeInactive: true })]);
  return (
    <div className="page-enter space-y-5">
      <div>
        <h1 className="text-2xl">Purchases</h1>
        <p className="text-sm text-muted">Everything received into stock. {rows.length} {rows.length === 1 ? "receipt" : "receipts"} worth {formatRupees(totalPaise)}{capped ? " (the latest 2,000; narrow the dates to see older ones)" : ""}.</p>
      </div>
      <form className="flex flex-wrap items-end gap-3" method="get" action="/inventory/purchases">
        <label className="block"><span className="label-xs mb-1.5 block">Vendor</span>
          <select name="vendor" className="input !w-auto" defaultValue={f.vendor}><option value="">All vendors</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
        <label className="block"><span className="label-xs mb-1.5 block">From</span><input type="date" name="from" className="input !w-auto" defaultValue={f.from} /></label>
        <label className="block"><span className="label-xs mb-1.5 block">To</span><input type="date" name="to" className="input !w-auto" defaultValue={f.to} /></label>
        <button className="btn btn-primary btn-sm">Show</button>
        {(f.vendor || f.from || f.to) && <Link href="/inventory/purchases" className="btn btn-ghost btn-sm">Clear</Link>}
      </form>
      <div className="table-wrap"><table>
        <thead><tr><th>Received</th><th>Item</th><th className="text-right">Quantity</th><th className="text-right">Rate</th><th className="text-right">Value</th><th>Vendor</th><th>PO</th><th>Challan</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap text-xs text-muted">{formatIST(r.createdAt)}<span className="block">by {r.actorName}</span></td>
              <td><b>{r.item}</b></td>
              <td className="text-right">{r.quantity} {r.unit}</td>
              <td className="text-right">{formatRupees(r.ratePaise)}</td>
              <td className="text-right">{r.ratePaise == null ? "—" : formatRupees(r.quantity * r.ratePaise)}</td>
              <td>{r.vendor ?? <span className="text-subtle">—</span>}</td>
              <td>{r.poId && r.poNo ? <Link href={`/inventory/purchase-orders/${r.poId}`} className="font-mono text-primary hover:underline">{r.poNo}</Link> : <span className="text-subtle">—</span>}</td>
              <td>{r.challanNo ?? <span className="text-subtle">—</span>}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={8} className="text-subtle">Nothing received{f.vendor || f.from || f.to ? " matches" : " yet"}.</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}
