"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useToast } from "@/components/Toast";
import { formatRupees, paiseToInput } from "@/lib/inventory/format";
import { rupeesToPaise } from "@/lib/inventory/validation";
import { inventoryApi } from "./api";

type VendorOption = { id: string; name: string };
type ItemOption = { id: string; name: string; unit: string; ratePaise: number | null };
type Line = { key: number; itemId: string; description: string; quantity: string; rate: string };
export type POFormInitial = { id: string; poNo: string; vendorId: string | null; vendorName: string; notes: string | null; lines: { itemId: string | null; description: string; quantity: number; ratePaise: number }[] };

let nextKey = 1;
const blankLine = (): Line => ({ key: nextKey++, itemId: "", description: "", quantity: "1", rate: "" });

/** Creating a purchase order, or editing a draft: the vendor (from the directory or typed), the lines and notes. */
export function POForm({ vendors, items, initial }: { vendors: VendorOption[]; items: ItemOption[]; initial?: POFormInitial }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  // A draft whose vendor is no longer in the active directory keeps its name, typed.
  const knownVendor = !!initial?.vendorId && vendors.some((v) => v.id === initial.vendorId);
  const [vendorId, setVendorId] = useState(initial ? (knownVendor ? initial.vendorId! : "") : "");
  const [typed, setTyped] = useState(initial && !knownVendor ? initial.vendorName : "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [lines, setLines] = useState<Line[]>(() => initial?.lines.length
    ? initial.lines.map((l) => ({ key: nextKey++, itemId: l.itemId ?? "", description: l.itemId ? (items.find((i) => i.id === l.itemId)?.name === l.description ? "" : l.description) : l.description, quantity: String(l.quantity), rate: paiseToInput(l.ratePaise) }))
    : [blankLine()]);
  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const amount = (l: Line) => { const p = rupeesToPaise(l.rate); return typeof p === "number" ? p * (Number(l.quantity) || 0) : 0; };
  const total = lines.reduce((t, l) => t + amount(l), 0);

  const submit = () => start(async () => {
    const body = { vendorId, vendorName: vendorId ? "" : typed, notes, lines: lines.map(({ itemId, description, quantity, rate }) => ({ itemId, description, quantity, rate })) };
    try {
      if (initial) {
        await inventoryApi(`/api/inventory/purchase-orders/${initial.id}`, "PATCH", body);
        toast.success("Draft saved");
        router.push(`/inventory/purchase-orders/${initial.id}`);
      } else {
        const r = await inventoryApi<{ purchaseOrder: { id: string; poNo: string } }>("/api/inventory/purchase-orders", "POST", body);
        toast.success(`${r.purchaseOrder.poNo} created as a draft`);
        router.push(`/inventory/purchase-orders/${r.purchaseOrder.id}`);
      }
      router.refresh();
    } catch (e) { toast.error((e as Error).message); }
  });

  const label = "label-xs mb-1.5 block";
  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className={label}>Vendor</span>
          <select className="input" value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">Not in the directory (type the name)</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select></label>
        {!vendorId && <label className="block"><span className={label}>Vendor name</span>
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={120} required /></label>}
      </div>

      <div className="table-wrap"><table>
        <thead><tr><th>Item</th><th className="w-28">Quantity</th><th className="w-36">Rate (₹)</th><th className="w-32 text-right">Amount</th><th className="w-12"><span className="sr-only">Remove</span></th></tr></thead>
        <tbody>
          {lines.map((l, n) => {
            const item = items.find((i) => i.id === l.itemId);
            return (
              <tr key={l.key}>
                <td className="space-y-2">
                  <select className="input" aria-label={`Line ${n + 1} item`} value={l.itemId}
                    onChange={(e) => { const it = items.find((i) => i.id === e.target.value); setLine(l.key, { itemId: e.target.value, rate: l.rate || (it?.ratePaise != null ? paiseToInput(it.ratePaise) : "") }); }}>
                    <option value="">Not in the catalogue (describe it)</option>
                    {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
                  </select>
                  <input className="input" aria-label={`Line ${n + 1} description`} placeholder={item ? `Description (optional, default “${item.name}”)` : "Description"} value={l.description}
                    onChange={(e) => setLine(l.key, { description: e.target.value })} maxLength={200} required={!l.itemId} />
                </td>
                <td><input className="input" aria-label={`Line ${n + 1} quantity`} type="number" min={1} step={1} value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} required /></td>
                <td><input className="input" aria-label={`Line ${n + 1} rate`} inputMode="decimal" value={l.rate} onChange={(e) => setLine(l.key, { rate: e.target.value })} required maxLength={20} /></td>
                <td className="text-right">{formatRupees(amount(l))}</td>
                <td><button type="button" className="chip !p-1.5 text-brand-red" aria-label={`Remove line ${n + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 size={14} /></button></td>
              </tr>
            );
          })}
        </tbody>
        <tfoot><tr><td colSpan={3}><button type="button" className="btn btn-ghost btn-sm" disabled={lines.length >= 100} onClick={() => setLines((ls) => [...ls, blankLine()])}><Plus size={14} /> Add line</button></td>
          <td className="text-right font-semibold">{formatRupees(total)}</td><td /></tr></tfoot>
      </table></div>

      <label className="block"><span className={label}>Notes (optional)</span>
        <textarea className="input min-h-20" placeholder="Delivery address, terms, contact…" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} /></label>
      <div className="flex gap-2">
        <button className="btn btn-primary btn-sm" disabled={pending}>{initial ? "Save draft" : "Create draft"}</button>
        <Link href={initial ? `/inventory/purchase-orders/${initial.id}` : "/inventory/purchase-orders"} className="btn btn-ghost btn-sm">Cancel</Link>
      </div>
    </form>
  );
}
