import Link from "next/link";
import { Plus } from "lucide-react";
import { PO_BADGE } from "@/components/inventory/po-badge";
import { formatRupees } from "@/lib/inventory/format";
import { requirePage } from "@/lib/inventory/guard";
import { PO_STATUSES, listPurchaseOrders, poStatusCounts, type PoStatus } from "@/lib/inventory/purchase-orders";
import { formatIST } from "@/lib/format";

export const metadata = { title: "Purchase orders · Inventory · MCCIA App Hub" };

/** Purchase orders, newest first with drafts and open orders on top. Inventory admin only. */
export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePage("inventory_admin");
  const raw = String((await searchParams).status ?? "");
  const status = (PO_STATUSES as readonly string[]).includes(raw) ? (raw as PoStatus) : undefined;
  const [orders, counts] = await Promise.all([listPurchaseOrders(status), poStatusCounts()]);
  return (
    <div className="page-enter space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Purchase orders</h1>
          <p className="text-sm text-muted">Draft an order, send it to the vendor, then receive the goods into stock.</p>
        </div>
        <Link href="/inventory/purchase-orders/new" className="btn btn-primary btn-sm"><Plus size={14} /> New purchase order</Link>
      </div>
      <nav className="flex flex-wrap gap-2" aria-label="Show purchase orders">
        {([undefined, ...PO_STATUSES] as (PoStatus | undefined)[]).map((s) => (
          <Link key={s ?? "all"} href={`/inventory/purchase-orders${s ? `?status=${s}` : ""}`} aria-current={status === s ? "page" : undefined}
            className={`chip ${status === s ? "!border-[#2a6b7c] !bg-[#f0f7f9] text-primary" : "text-muted"}`}>
            {s ? PO_BADGE[s].label : "All"}{s && <span className="ml-1.5 font-semibold">{counts[s]}</span>}
          </Link>
        ))}
      </nav>
      <div className="table-wrap"><table>
        <thead><tr><th>PO number</th><th>Vendor</th><th className="text-right">Lines</th><th className="text-right">Total</th><th>Status</th><th>Created</th></tr></thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td><Link href={`/inventory/purchase-orders/${o.id}`} className="font-mono font-semibold text-primary hover:underline">{o.poNo}</Link></td>
              <td>{o.vendorName}</td>
              <td className="text-right">{o.lines}</td>
              <td className="text-right">{formatRupees(o.totalPaise)}</td>
              <td><span className={PO_BADGE[o.status].cls}>{PO_BADGE[o.status].label}</span>{o.partlyReceived && <span className="badge badge-neutral ml-1.5">Partly received</span>}</td>
              <td className="text-xs text-muted">{formatIST(o.createdAt)}<span className="block">by {o.createdByName}</span></td>
            </tr>
          ))}
          {orders.length === 0 && <tr><td colSpan={6} className="text-subtle">{status ? "No purchase orders with this status." : "No purchase orders yet."}</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}
