"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Ban, PackageCheck, Pencil, Send } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import type { PoStatus } from "@/lib/inventory/po-number";
import { inventoryApi } from "./api";

type Line = { id: string; label: string; unit: string | null; quantity: number; receivedQuantity: number; inCatalogue: boolean };

/** What can be done with one purchase order now: edit and send a draft, receive goods on a sent order (at a branch), cancel either. */
export function POActions({ id, poNo, vendorName, status, lines, branches, ownBranchId }: {
  id: string; poNo: string; vendorName: string; status: PoStatus; lines: Line[]; branches: { id: string; name: string }[]; ownBranchId: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [receiving, setReceiving] = useState(false);
  const open = lines.filter((l) => l.quantity > l.receivedQuantity);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [challanNo, setChallanNo] = useState("");
  const [close, setClose] = useState(false);
  const [branchId, setBranchId] = useState("");

  const run = (fn: () => Promise<unknown>, done: string, after?: () => void) => start(async () => {
    try { await fn(); toast.success(done); after?.(); router.refresh(); } catch (e) { toast.error((e as Error).message); }
  });
  // Asked before the transition starts: a dialog opened inside one never shows.
  const send = async () => {
    if (!(await confirm({ title: `Send ${poNo}?`, confirmLabel: "Mark as sent", message: `It will be marked as sent to ${vendorName} and can no longer be edited. (Send the order to the vendor yourself; the hub does not email it.)` }))) return;
    run(() => inventoryApi(`/api/inventory/purchase-orders/${id}/send`, "POST"), `${poNo} marked as sent`);
  };
  const cancel = async () => {
    if (!(await confirm({ title: `Cancel ${poNo}?`, confirmLabel: "Cancel order", danger: true,
      message: status === "sent" ? "Nothing more will be received on it. Anything already received stays in stock." : "The draft will be kept, marked as cancelled." }))) return;
    run(() => inventoryApi(`/api/inventory/purchase-orders/${id}/cancel`, "POST"), `${poNo} cancelled`);
  };
  const openReceive = () => {
    setQty(Object.fromEntries(open.map((l) => [l.id, String(l.quantity - l.receivedQuantity)]))); setChallanNo(""); setClose(false);
    setBranchId(branches.some((b) => b.id === ownBranchId) ? (ownBranchId ?? "") : (branches[0]?.id ?? "")); setReceiving(true);
  };
  const receive = () => run(() => inventoryApi(`/api/inventory/purchase-orders/${id}/receive`, "POST", {
    lines: open.map((l) => ({ lineId: l.id, quantity: qty[l.id] || "0" })), challanNo, close, branchId,
  }), "Goods received; stock updated", () => setReceiving(false));

  if (status === "received" || status === "cancelled") return null;
  return (
    <div className="flex flex-wrap gap-2">
      {status === "draft" && <>
        <Link href={`/inventory/purchase-orders/${id}/edit`} className="btn btn-ghost btn-sm"><Pencil size={14} /> Edit</Link>
        <button className="btn btn-primary btn-sm" disabled={pending} onClick={send}><Send size={14} /> Mark as sent</button>
      </>}
      {status === "sent" && <button className="btn btn-primary btn-sm" disabled={pending} onClick={openReceive}><PackageCheck size={14} /> Receive goods</button>}
      <button className="btn btn-ghost btn-sm text-brand-red" disabled={pending} onClick={cancel}><Ban size={14} /> Cancel order</button>

      {receiving && (
        <Modal title={`Receive goods on ${poNo}`} onClose={() => setReceiving(false)}>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); receive(); }}>
            <p className="text-sm text-muted">Enter what arrived now (0 for a line that did not). Catalogue items go into the branch&apos;s stock at once.</p>
            <label className="block"><span className="label-xs mb-1.5 block">Arrived at branch</span>
              <select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)} required>
                <option value="">Choose a branch</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></label>
            <div className="table-wrap"><table>
              <thead><tr><th>Line</th><th className="text-right">Still to come</th><th className="w-32">Arrived now</th></tr></thead>
              <tbody>{open.map((l) => (
                <tr key={l.id}>
                  <td>{l.label}{!l.inCatalogue && <span className="block text-xs text-muted">Not a catalogue item: no stock is added</span>}</td>
                  <td className="text-right">{l.quantity - l.receivedQuantity}{l.unit ? ` ${l.unit}` : ""}</td>
                  <td><input className="input" type="number" min={0} max={l.quantity - l.receivedQuantity} step={1} aria-label={`Arrived now: ${l.label}`}
                    value={qty[l.id] ?? ""} onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))} /></td>
                </tr>
              ))}</tbody>
            </table></div>
            <label className="block"><span className="label-xs mb-1.5 block">Delivery challan / invoice number (optional)</span>
              <input className="input" value={challanNo} onChange={(e) => setChallanNo(e.target.value)} maxLength={60} /></label>
            <label className="flex cursor-pointer items-start gap-2.5">
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={close} onChange={(e) => setClose(e.target.checked)} />
              <span className="text-sm"><b>Nothing more is coming: close this order</b><span className="block text-xs text-muted">It closes by itself once every line has fully arrived.</span></span>
            </label>
            <button className="btn btn-primary btn-sm" disabled={pending}>Record receipt</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
