"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PackageMinus, Undo2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { formatIST } from "@/lib/format";
import { inventoryApi } from "./api";

export type IssueView = {
  id: string; item: string; unit: string; quantity: number; returned: number; outstanding: number; issuedToName: string | null;
  departmentId: string | null; eventName: string | null; note: string | null; requestId: string | null; actorName: string; createdAt: string; lastReturnAt: string | null;
};
type ItemOption = { id: string; name: string; unit: string; quantity: number };
type Option = { id: string; name: string };
type Filter = "out" | "returned" | "all";

function IssueForm({ items, people, departments, pending, onSubmit }: { items: ItemOption[]; people: Option[]; departments: Option[]; pending: boolean; onSubmit: (v: Record<string, string>) => void }) {
  const [v, setV] = useState({ itemId: "", quantity: "1", userId: "", name: "", departmentId: "", eventName: "", note: "" });
  const set = (k: keyof typeof v, val: string) => setV((s) => ({ ...s, [k]: val }));
  const chosen = items.find((i) => i.id === v.itemId);
  const label = "label-xs mb-1.5 block";
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSubmit(v); }}>
      <label className="block"><span className={label}>Item</span>
        <select className="input" value={v.itemId} onChange={(e) => set("itemId", e.target.value)} required autoFocus>
          <option value="">Choose an item</option>
          {items.map((i) => <option key={i.id} value={i.id} disabled={i.quantity === 0}>{i.name} ({i.quantity} {i.unit} in stock)</option>)}
        </select></label>
      <label className="block"><span className={label}>Quantity{chosen ? ` (${chosen.quantity} ${chosen.unit} in stock)` : ""}</span>
        <input className="input" type="number" min={1} max={chosen?.quantity} step={1} value={v.quantity} onChange={(e) => set("quantity", e.target.value)} required /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className={label}>Issued to (a hub user)</span>
          <select className="input" value={v.userId} onChange={(e) => set("userId", e.target.value)}>
            <option value="">Someone else (type the name)</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></label>
        {!v.userId && <label className="block"><span className={label}>Their name</span>
          <input className="input" value={v.name} onChange={(e) => set("name", e.target.value)} maxLength={120} required placeholder="Who receives it" /></label>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className={label}>Department (optional)</span>
          <select className="input" value={v.departmentId} onChange={(e) => set("departmentId", e.target.value)}>
            <option value="">None</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select></label>
        <label className="block"><span className={label}>Event (optional)</span>
          <input className="input" value={v.eventName} onChange={(e) => set("eventName", e.target.value)} maxLength={120} placeholder="e.g. Annual conference" /></label>
      </div>
      <label className="block"><span className={label}>Note (optional)</span>
        <textarea className="input min-h-16" value={v.note} onChange={(e) => set("note", e.target.value)} maxLength={500} /></label>
      <button className="btn btn-primary btn-sm" disabled={pending || !v.itemId}>Issue</button>
    </form>
  );
}

/** Issues and returns. Inventory admins issue items and take them back; everyone else sees what has been issued to them. */
export function IssuesView({ rows, items, people, departments, canManage, filter }: {
  rows: IssueView[]; items: ItemOption[]; people: Option[]; departments: Option[]; canManage: boolean; filter: Filter;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [issuing, setIssuing] = useState(false);
  const [returning, setReturning] = useState<IssueView | null>(null);
  const [ret, setRet] = useState({ quantity: "", note: "" });
  const deptName = (id: string | null) => departments.find((d) => d.id === id)?.name;

  const run = (fn: () => Promise<unknown>, done: string, after?: () => void) => start(async () => {
    try { await fn(); toast.success(done); after?.(); router.refresh(); } catch (e) { toast.error((e as Error).message); }
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">{canManage ? "Issues & returns" : "Issued to me"}</h1>
          <p className="text-sm text-muted">{canManage ? "Items handed out, to whom, and what has come back. Issuing takes the stock out; a return puts it back." : "What the store has handed to you, and what you have returned."}</p>
        </div>
        {canManage && <button className="btn btn-primary btn-sm" onClick={() => setIssuing(true)}><PackageMinus size={14} /> Issue item</button>}
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Show issues">
        {(["out", "returned", "all"] as const).map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} onClick={() => router.replace(`/inventory/issues${f === "out" ? "" : `?show=${f}`}`)}
            className={`chip ${filter === f ? "!border-[#2a6b7c] !bg-[#f0f7f9] text-primary" : "text-muted"}`}>
            {f === "out" ? "Still out" : f === "returned" ? "Returned" : "All"}
          </button>
        ))}
      </div>

      <div className="table-wrap"><table>
        <thead><tr><th>Item</th><th className="text-right">Issued</th><th>To</th><th>When</th><th>Returned</th>{canManage && <th className="text-right">Actions</th>}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><b>{r.item}</b>{r.note && <span className="block max-w-xs text-xs text-muted">{r.note}</span>}{r.requestId && <span className="badge badge-neutral mt-1">From a request</span>}</td>
              <td className="text-right">{r.quantity} {r.unit}</td>
              <td>{r.issuedToName ?? "—"}<span className="block text-xs text-muted">{[deptName(r.departmentId), r.eventName].filter(Boolean).join(" · ")}</span></td>
              <td className="text-xs text-muted">{formatIST(r.createdAt)}<span className="block">by {r.actorName}</span></td>
              <td>{r.outstanding <= 0 ? <span className="badge badge-green">All returned</span>
                : r.returned > 0 ? <span className="badge badge-purple">{r.returned} of {r.quantity} back</span>
                : <span className="badge badge-neutral">Not returned</span>}
                {r.lastReturnAt && <span className="mt-0.5 block text-xs text-subtle">{formatIST(r.lastReturnAt)}</span>}</td>
              {canManage && (
                <td className="text-right">{r.outstanding > 0 && (
                  <button className="btn btn-ghost btn-sm" disabled={pending} aria-label={`Mark ${r.item} issued to ${r.issuedToName ?? "someone"} returned`}
                    onClick={() => { setRet({ quantity: String(r.outstanding), note: "" }); setReturning(r); }}><Undo2 size={14} /> Mark returned</button>
                )}</td>
              )}
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={canManage ? 6 : 5} className="text-subtle">{filter === "out" ? "Nothing is out right now." : filter === "returned" ? "Nothing returned yet." : "Nothing issued yet."}</td></tr>}
        </tbody>
      </table></div>

      {issuing && (
        <Modal title="Issue an item" onClose={() => setIssuing(false)}>
          <IssueForm items={items} people={people} departments={departments} pending={pending}
            onSubmit={(v) => run(() => inventoryApi("/api/inventory/issues", "POST", v), "Item issued; stock updated", () => setIssuing(false))} />
        </Modal>
      )}
      {returning && (
        <Modal title={`Return ${returning.item}`} onClose={() => setReturning(null)}>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => inventoryApi(`/api/inventory/issues/${returning.id}/return`, "POST", ret), "Return recorded; stock updated", () => setReturning(null)); }}>
            <p className="text-sm text-muted">{returning.outstanding} of {returning.quantity} {returning.unit} still out with {returning.issuedToName ?? "them"}.</p>
            <label className="block"><span className="label-xs mb-1.5 block">Quantity returned</span>
              <input className="input" type="number" min={1} max={returning.outstanding} step={1} value={ret.quantity} onChange={(e) => setRet({ ...ret, quantity: e.target.value })} required autoFocus /></label>
            <label className="block"><span className="label-xs mb-1.5 block">Note (optional)</span>
              <textarea className="input min-h-16" placeholder="Condition, who brought it back…" value={ret.note} onChange={(e) => setRet({ ...ret, note: e.target.value })} maxLength={500} /></label>
            <button className="btn btn-primary btn-sm" disabled={pending}>Record return</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
