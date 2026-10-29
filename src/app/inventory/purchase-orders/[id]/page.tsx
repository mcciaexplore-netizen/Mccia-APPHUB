import Link from "next/link";
import { notFound } from "next/navigation";
import { POActions } from "@/components/inventory/POActions";
import { PO_BADGE } from "@/components/inventory/po-badge";
import { formatRupees } from "@/lib/inventory/format";
import { requirePage } from "@/lib/inventory/guard";
import { getPurchaseOrder } from "@/lib/inventory/purchase-orders";
import { idSchema } from "@/lib/inventory/validation";
import { formatIST } from "@/lib/format";

export const metadata = { title: "Purchase order · Inventory · MCCIA App Hub" };

/** One purchase order: vendor, lines (with what has arrived), notes, the receipts so far, and what can be done with it now. */
export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage("inventory_admin");
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const po = await getPurchaseOrder(id);
  if (!po) notFound();
  const poNo = po.poNo ?? "";
  const anyReceived = po.lines.some((l) => l.receivedQuantity > 0);
  return (
    <div className="page-enter space-y-6">
      <div>
        <Link href="/inventory/purchase-orders" className="text-sm text-muted hover:text-primary">← Purchase orders</Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex flex-wrap items-center gap-3 text-2xl"><span className="font-mono">{poNo}</span>
            <span className={PO_BADGE[po.status].cls}>{PO_BADGE[po.status].label}</span>
            {po.status === "sent" && anyReceived && <span className="badge badge-neutral">Partly received</span>}</h1>
          <POActions id={id} poNo={poNo} vendorName={po.vendorName} status={po.status}
            lines={po.lines.map((l) => ({ id: l.id, label: l.description, unit: l.unit, quantity: l.quantity, receivedQuantity: l.receivedQuantity, inCatalogue: !!l.itemId }))} />
        </div>
      </div>

      <section className="glass !rounded-md grid gap-4 p-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><p className="label-xs">Vendor</p><p className="mt-1 font-semibold">{po.vendorName}</p>{po.vendorEmail && <a className="text-primary hover:underline" href={`mailto:${po.vendorEmail}`}>{po.vendorEmail}</a>}</div>
        <div><p className="label-xs">Created</p><p className="mt-1">{formatIST(po.createdAt)}</p><p className="text-muted">by {po.createdByName}</p></div>
        <div><p className="label-xs">Sent</p><p className="mt-1">{po.sentAt ? formatIST(po.sentAt) : "—"}</p></div>
        <div><p className="label-xs">Received</p><p className="mt-1">{po.receivedAt ? formatIST(po.receivedAt) : "—"}</p></div>
      </section>

      <div className="table-wrap"><table>
        <thead><tr><th>Item</th><th className="text-right">Quantity</th><th className="text-right">Rate</th><th className="text-right">Amount</th><th className="text-right">Received</th></tr></thead>
        <tbody>{po.lines.map((l) => (
          <tr key={l.id}>
            <td><b>{l.description}</b>{!l.itemId && <span className="block text-xs text-muted">Not a catalogue item</span>}</td>
            <td className="text-right">{l.quantity}{l.unit ? ` ${l.unit}` : ""}</td>
            <td className="text-right">{formatRupees(l.ratePaise)}</td>
            <td className="text-right">{formatRupees(l.quantity * l.ratePaise)}</td>
            <td className={`text-right ${l.receivedQuantity >= l.quantity ? "text-[var(--c-green-text)]" : l.receivedQuantity > 0 ? "font-semibold" : "text-muted"}`}>{l.receivedQuantity} of {l.quantity}</td>
          </tr>
        ))}</tbody>
        <tfoot><tr><td colSpan={3} className="text-right font-semibold">Total</td><td className="text-right font-semibold">{formatRupees(po.totalPaise)}</td><td /></tr></tfoot>
      </table></div>

      {po.notes && <section className="glass !rounded-md p-5"><p className="label-xs">Notes</p><p className="mt-1 whitespace-pre-line text-sm">{po.notes}</p></section>}

      {po.receipts.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg">Received into stock</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>When</th><th>Item</th><th className="text-right">Quantity</th><th>Challan / invoice</th><th>By</th></tr></thead>
            <tbody>{po.receipts.map((r) => (
              <tr key={r.id}><td className="text-xs text-muted">{formatIST(r.createdAt)}</td><td>{r.item}</td><td className="text-right text-[var(--c-green-text)]">+{r.quantity}</td>
                <td>{r.challanNo ?? <span className="text-subtle">—</span>}</td><td>{r.actorName}</td></tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
    </div>
  );
}
