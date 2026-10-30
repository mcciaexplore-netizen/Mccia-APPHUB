"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowRight, ArrowRightLeft } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { formatIST } from "@/lib/format";
import { inventoryApi } from "./api";

type Option = { id: string; name: string };
/** How many of an item one branch has. */
type StockRow = { itemId: string; item: string; unit: string; branchId: string; quantity: number };
export type TransferView = { id: string; item: string; unit: string; fromBranch: string; toBranch: string; quantity: number; reason: string | null; actorName: string; createdAt: string };

/** The transfer form: an item, the branch it leaves and the one it goes to, how many, and why. The source shows what it has. */
function TransferForm({ branches, stock, pending, onSubmit }: { branches: Option[]; stock: StockRow[]; pending: boolean; onSubmit: (v: Record<string, string>) => void }) {
  const [v, setV] = useState({ itemId: "", fromBranchId: "", toBranchId: "", quantity: "1", reason: "" });
  const set = (k: keyof typeof v, val: string) => setV((s) => ({ ...s, [k]: val }));
  const items = [...new Map(stock.map((s) => [s.itemId, { id: s.itemId, name: s.item, unit: s.unit }])).values()].sort((a, b) => a.name.localeCompare(b.name));
  const item = items.find((i) => i.id === v.itemId);
  const haveAt = (branchId: string) => stock.find((s) => s.itemId === v.itemId && s.branchId === branchId)?.quantity;
  const available = v.fromBranchId ? haveAt(v.fromBranchId) ?? 0 : undefined;
  const label = "label-xs mb-1.5 block";
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSubmit(v); }}>
      <label className="block"><span className={label}>Item</span>
        <select className="input" value={v.itemId} onChange={(e) => setV((s) => ({ ...s, itemId: e.target.value, fromBranchId: "" }))} required autoFocus>
          <option value="">Choose an item</option>
          {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className={label}>From branch</span>
          <select className="input" value={v.fromBranchId} onChange={(e) => set("fromBranchId", e.target.value)} required disabled={!v.itemId}>
            <option value="">Choose a branch</option>
            {branches.map((b) => {
              const n = haveAt(b.id);
              return <option key={b.id} value={b.id} disabled={!n}>{b.name}{v.itemId ? ` (${n ?? 0}${item ? ` ${item.unit}` : ""})` : ""}</option>;
            })}
          </select></label>
        <label className="block"><span className={label}>To branch</span>
          <select className="input" value={v.toBranchId} onChange={(e) => set("toBranchId", e.target.value)} required>
            <option value="">Choose a branch</option>
            {branches.filter((b) => b.id !== v.fromBranchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select></label>
      </div>
      <label className="block"><span className={label}>Quantity{available !== undefined ? ` (${available}${item ? ` ${item.unit}` : ""} at the source)` : ""}</span>
        <input className="input" type="number" min={1} max={available || undefined} step={1} value={v.quantity} onChange={(e) => set("quantity", e.target.value)} required /></label>
      <label className="block"><span className={label}>Reason (optional)</span>
        <textarea className="input min-h-16" placeholder="Why it is moving" value={v.reason} onChange={(e) => set("reason", e.target.value)} maxLength={500} /></label>
      <button className="btn btn-primary btn-sm" disabled={pending || !v.itemId || !v.fromBranchId || !v.toBranchId}>Transfer</button>
    </form>
  );
}

/** Transfers between branches: Inventory admins move stock, and see every transfer made, newest first. */
export function TransfersView({ branches, stock, rows }: { branches: Option[]; stock: StockRow[]; rows: TransferView[] }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const name = (id: string) => branches.find((b) => b.id === id)?.name ?? "";

  // Asked before the transition starts: a dialog opened inside one never shows.
  const submit = async (v: Record<string, string>) => {
    const item = stock.find((s) => s.itemId === v.itemId);
    if (!(await confirm({ title: "Transfer this stock?", confirmLabel: "Transfer",
      message: `${v.quantity} ${item?.unit ?? ""} of “${item?.item ?? "the item"}” will move from ${name(v.fromBranchId)} to ${name(v.toBranchId)}. A movement is recorded at each branch.` }))) return;
    start(async () => {
      try { await inventoryApi("/api/inventory/transfers", "POST", v); toast.success("Stock transferred"); setOpen(false); router.refresh(); } catch (e) { toast.error((e as Error).message); }
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Transfers</h1>
          <p className="text-sm text-muted">Move stock from one branch to another. It leaves the source and arrives at the destination in one step.</p>
        </div>
        <button className="btn btn-primary btn-sm" disabled={branches.length < 2} onClick={() => setOpen(true)}><ArrowRightLeft size={14} /> Transfer stock</button>
      </div>
      {branches.length < 2 && <p className="text-sm text-muted">Transfers need at least two active branches (Administrator → Branches).</p>}

      <div className="table-wrap"><table>
        <thead><tr><th>When</th><th>Item</th><th className="text-right">Quantity</th><th>From → To</th><th>Reason</th><th>By</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap text-xs text-muted">{formatIST(r.createdAt)}</td>
              <td><b>{r.item}</b></td>
              <td className="text-right">{r.quantity} {r.unit}</td>
              <td className="whitespace-nowrap">{r.fromBranch} <ArrowRight size={12} className="inline align-[-1px] text-muted" aria-label="to" /> {r.toBranch}</td>
              <td className="text-xs">{r.reason ?? <span className="text-subtle">—</span>}</td>
              <td className="text-xs">{r.actorName}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="text-subtle">No transfers yet.</td></tr>}
        </tbody>
      </table></div>

      {open && (
        <Modal title="Transfer stock" onClose={() => setOpen(false)}>
          <TransferForm branches={branches} stock={stock} pending={pending} onSubmit={submit} />
        </Modal>
      )}
    </div>
  );
}
