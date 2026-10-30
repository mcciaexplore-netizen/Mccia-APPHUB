"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, PackageCheck, Plus, X } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { formatIST } from "@/lib/format";
import { inventoryApi } from "./api";

export type RequestView = {
  id: string; item: string; unit: string; branchName: string; /** At the request's branch. */ inStock: number; quantity: number; note: string | null; status: string; requestedByName: string;
  requestedAt: string; resolvedByName: string | null; resolvedAt: string | null; rejectReason: string | null;
};
type ItemOption = { id: string; name: string; unit: string; quantity: number };
type Status = "pending" | "approved" | "fulfilled" | "rejected";
type Branch = { id: string; name: string; active: boolean };

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "badge badge-purple" },
  approved: { label: "Approved", cls: "badge" },
  fulfilled: { label: "Fulfilled", cls: "badge badge-green" },
  rejected: { label: "Rejected", cls: "badge badge-red" },
  cancelled: { label: "Cancelled", cls: "badge badge-neutral" },
};

function NewRequest({ items, pending, onSubmit }: { items: ItemOption[]; pending: boolean; onSubmit: (v: { itemId: string; quantity: string; note: string }) => void }) {
  const [v, setV] = useState({ itemId: "", quantity: "1", note: "" });
  const chosen = items.find((i) => i.id === v.itemId);
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSubmit(v); }}>
      <label className="block"><span className="label-xs mb-1.5 block">Item</span>
        <select className="input" value={v.itemId} onChange={(e) => setV({ ...v, itemId: e.target.value })} required autoFocus>
          <option value="">Choose an item</option>
          {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.quantity} {i.unit} in stock)</option>)}
        </select></label>
      <label className="block"><span className="label-xs mb-1.5 block">Quantity{chosen ? ` (${chosen.unit})` : ""}</span>
        <input className="input" type="number" min={1} step={1} value={v.quantity} onChange={(e) => setV({ ...v, quantity: e.target.value })} required /></label>
      {chosen && Number(v.quantity) > chosen.quantity && <p className="text-xs text-muted">Only {chosen.quantity} in stock now. You can still ask; the store will decide.</p>}
      <label className="block"><span className="label-xs mb-1.5 block">Note (optional)</span>
        <textarea className="input min-h-20" placeholder="What it is for, when you need it…" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} maxLength={500} /></label>
      <button className="btn btn-primary btn-sm" disabled={pending || !v.itemId}>Send request</button>
    </form>
  );
}

/**
 * Requests: everyone raises them, at their own branch, and follows their own. Inventory admins and Staff see everyone's, every branch or
 * one; Inventory admins approve, reject or fulfil (from the request's branch). With no branch, a person is told why they cannot request.
 */
export function RequestsView({ rows, items, canManage, seesAll, status, counts, branches, branchId, ownBranch, noBranch }: {
  rows: RequestView[]; items: ItemOption[]; canManage: boolean; seesAll: boolean; status: Status | ""; counts?: Record<Status, number>;
  branches: Branch[]; branchId: string; ownBranch: string | null; noBranch: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [creating, setCreating] = useState(false);
  const [rejecting, setRejecting] = useState<RequestView | null>(null);
  const [reason, setReason] = useState("");

  const run = (fn: () => Promise<unknown>, done: string, after?: () => void) => start(async () => {
    try { await fn(); toast.success(done); after?.(); router.refresh(); } catch (e) { toast.error((e as Error).message); }
  });
  const decide = (r: RequestView, body: Record<string, string>, done: string, after?: () => void) => run(() => inventoryApi(`/api/inventory/requests/${r.id}`, "PATCH", body), done, after);
  // Asked before the transition starts: a dialog opened inside one never shows.
  const fulfil = async (r: RequestView) => {
    if (!(await confirm({ title: "Fulfil this request?", confirmLabel: "Fulfil",
      message: `${r.quantity} ${r.unit} of “${r.item}” will be taken out of ${r.branchName}'s stock (${r.inStock} available there) and recorded as issued to ${r.requestedByName}.` }))) return;
    decide(r, { action: "fulfil" }, "Request fulfilled; stock updated");
  };
  // The status tab and the branch filter live in the address together.
  const go = (s: Status | "", b: string) => {
    const p = new URLSearchParams();
    if (s) p.set("status", s);
    if (b) p.set("branch", b);
    router.replace(`/inventory/requests${p.size ? `?${p}` : ""}`);
  };
  const tab = (s: Status | "") => go(s, branchId);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">{seesAll ? "Requests" : "My requests"}</h1>
          <p className="text-sm text-muted">{canManage ? "Everyone's requests to the store, at every branch. Approve, reject with a reason, then fulfil to hand the items over from the request's branch."
            : seesAll ? "Everyone's requests to the store, at every branch." : `Ask the store${ownBranch ? ` at ${ownBranch}` : ""} for an item and follow what happens to it.`}</p>
        </div>
        {!noBranch && <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={14} /> New request</button>}
      </div>

      {noBranch && <p role="status" className="rounded-md border border-[#fcd34d] bg-[#fff8e1] px-4 py-3 text-sm font-semibold text-[#b45309]">{noBranch}</p>}

      {seesAll && (
        <label className="flex items-center gap-2 text-sm text-muted">Branch
          <select className="input !w-auto" value={branchId} onChange={(e) => go(status, e.target.value)} aria-label="Branch">
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}{b.active ? "" : " (inactive)"}</option>)}
          </select></label>
      )}

      {seesAll && counts && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Show requests">
          {(["", "pending", "approved", "fulfilled", "rejected"] as const).map((s) => (
            <button key={s || "all"} role="tab" aria-selected={status === s} onClick={() => tab(s)}
              className={`chip ${status === s ? "!border-[#2a6b7c] !bg-[#f0f7f9] text-primary" : "text-muted"}`}>
              {s ? STATUS_BADGE[s].label : "All"}{s && <span className="ml-1.5 font-semibold">{counts[s]}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="table-wrap"><table>
        <thead><tr><th>Item</th><th className="text-right">Quantity</th>{seesAll && <th>Branch</th>}{seesAll && <th>Requested by</th>}<th>Requested</th><th>Status</th>{canManage && <th className="text-right">Actions</th>}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><b>{r.item}</b>{r.note && <span className="block max-w-sm text-xs text-muted">{r.note}</span>}</td>
              <td className="text-right">{r.quantity} {r.unit}{canManage && r.status === "approved" && r.inStock < r.quantity && <span className="block text-xs font-semibold text-brand-red">only {r.inStock} in stock there</span>}</td>
              {seesAll && <td>{r.branchName}</td>}
              {seesAll && <td>{r.requestedByName}</td>}
              <td className="text-xs text-muted">{formatIST(r.requestedAt)}</td>
              <td><span className={STATUS_BADGE[r.status]?.cls ?? "badge"}>{STATUS_BADGE[r.status]?.label ?? r.status}</span>
                {r.status === "rejected" && r.rejectReason && <span className="mt-1 block max-w-xs text-xs text-muted">Reason: {r.rejectReason}</span>}
                {r.resolvedByName && r.status !== "pending" && <span className="mt-0.5 block text-xs text-subtle">by {r.resolvedByName}</span>}</td>
              {canManage && (
                <td><div className="flex justify-end gap-1.5">
                  {r.status === "pending" && <>
                    <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => decide(r, { action: "approve" }, "Request approved")}><Check size={14} /> Approve</button>
                    <button className="btn btn-ghost btn-sm text-brand-red" disabled={pending} onClick={() => { setReason(""); setRejecting(r); }}><X size={14} /> Reject</button>
                  </>}
                  {r.status === "approved" && <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => fulfil(r)}><PackageCheck size={14} /> Fulfil</button>}
                </div></td>
              )}
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={4 + (seesAll ? 2 : 0) + (canManage ? 1 : 0)} className="text-subtle">{status || branchId ? "No requests match." : seesAll ? "No requests yet." : "You haven't asked for anything yet."}</td></tr>}
        </tbody>
      </table></div>

      {creating && (
        <Modal title="New request" onClose={() => setCreating(false)}>
          {items.length === 0 ? <p className="text-sm text-muted">{ownBranch ? `${ownBranch} has no items to request yet.` : "The store has no items to request yet."}</p> : (
            <NewRequest items={items} pending={pending} onSubmit={(v) => run(() => inventoryApi("/api/inventory/requests", "POST", v), "Request sent", () => setCreating(false))} />
          )}
        </Modal>
      )}
      {rejecting && (
        <Modal title={`Reject request for ${rejecting.item}`} onClose={() => setRejecting(null)}>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); decide(rejecting, { action: "reject", reason }, "Request rejected", () => setRejecting(null)); }}>
            <p className="text-sm text-muted">{rejecting.requestedByName} asked for {rejecting.quantity} {rejecting.unit}. They will see this reason.</p>
            <label className="block"><span className="label-xs mb-1.5 block">Reason</span>
              <textarea className="input min-h-20" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required autoFocus /></label>
            <button className="btn btn-danger btn-sm" disabled={pending || !reason.trim()}>Reject request</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
