"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, Plus, Send, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { formatIST } from "@/lib/format";
import type { InvoiceStatus } from "@/lib/cabs/cabs.manifest";
import { formatRupees } from "@/lib/cabs/money";
import { cabsApi } from "./api";

export type InvoiceView = {
  id: string; invoiceNumber: string; branch: string; periodStart: string; periodEnd: string; totalRides: number; totalAmountPaise: number; status: InvoiceStatus;
  notes: string | null; createdByName: string; createdAt: string; paidAt: string | null;
};

/** draft grey, sent blue, paid green. */
const TONE: Record<InvoiceStatus, string> = { draft: "bg-alt text-muted", sent: "bg-[#e8f1fa] text-[#0b63ad]", paid: "bg-green-tint text-brand-green-text" };
export const InvoiceBadge = ({ status }: { status: InvoiceStatus }) => (
  <span className={`inline-block rounded-pill px-2.5 py-0.5 text-xs font-semibold capitalize ${TONE[status]}`} data-invoice-status={status}>{status}</span>
);
const day = (d: string) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

/** Invoices: create one for a branch and period (its rides and total are worked out), mark it sent, then paid; delete a draft. */
export function InvoicesView({ invoices, branches, today }: { invoices: InvoiceView[]; branches: string[]; today: string }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ branch: "", periodStart: `${today.slice(0, 8)}01`, periodEnd: today, notes: "" });
  const run = (fn: () => Promise<unknown>, done: string, after?: () => void) => start(async () => {
    try { await fn(); toast.success(done); after?.(); router.refresh(); } catch (e) { toast.error((e as Error).message); }
  });
  const remove = async (i: InvoiceView) => {
    if (!(await confirm({ title: `Delete ${i.invoiceNumber}?`, message: "Its rides can be invoiced again.", confirmLabel: "Delete", danger: true }))) return;
    run(() => cabsApi(`/api/cabs/invoices/${i.id}`, "DELETE"), "Draft deleted");
  };
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={14} /> Create invoice</button></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Invoice</th><th>Branch</th><th>Period</th><th className="text-right">Rides</th><th className="text-right">Total</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
        <tbody>
          {invoices.map((i) => (
            <tr key={i.id} data-invoice={i.id}>
              <td><b>{i.invoiceNumber}</b><span className="block text-xs text-subtle">by {i.createdByName}, {formatIST(i.createdAt).split(",")[0]}</span></td>
              <td>{i.branch}</td>
              <td className="whitespace-nowrap text-xs">{day(i.periodStart)} – {day(i.periodEnd)}</td>
              <td className="text-right">{i.totalRides}</td>
              <td className="text-right font-semibold">{formatRupees(i.totalAmountPaise)}</td>
              <td><InvoiceBadge status={i.status} />{i.paidAt && <span className="block text-xs text-subtle">{formatIST(i.paidAt).split(",")[0]}</span>}</td>
              <td><div className="flex justify-end gap-1.5">
                {i.status === "draft" && <>
                  <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => run(() => cabsApi(`/api/cabs/invoices/${i.id}/sent`, "POST"), "Marked sent")}><Send size={14} /> Mark sent</button>
                  <button className="btn btn-ghost btn-sm text-brand-red" disabled={pending} onClick={() => remove(i)} aria-label={`Delete ${i.invoiceNumber}`}><Trash2 size={14} /></button>
                </>}
                {i.status === "sent" && <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => run(() => cabsApi(`/api/cabs/invoices/${i.id}/paid`, "POST"), "Marked paid")}><CheckCircle2 size={14} /> Mark paid</button>}
              </div></td>
            </tr>
          ))}
          {invoices.length === 0 && <tr><td colSpan={7} className="text-subtle">No invoices yet.</td></tr>}
        </tbody>
      </table></div>
      {creating && (
        <Modal title="Create invoice" onClose={() => setCreating(false)}>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => cabsApi("/api/cabs/invoices", "POST", form), "Invoice created", () => setCreating(false)); }}>
            <label className="block"><span className="label-xs mb-1.5 block">Branch</span>
              <select className="input" name="branch" value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} required autoFocus>
                <option value="">Choose a branch</option>
                {branches.map((b) => <option key={b} value={b}>{b}</option>)}
              </select></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block"><span className="label-xs mb-1.5 block">From</span><input className="input" type="date" name="periodStart" value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} required /></label>
              <label className="block"><span className="label-xs mb-1.5 block">To</span><input className="input" type="date" name="periodEnd" value={form.periodEnd} min={form.periodStart} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} required /></label>
            </div>
            <label className="block"><span className="label-xs mb-1.5 block">Notes (optional)</span>
              <textarea className="input min-h-16" name="notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={1000} /></label>
            <p className="text-xs text-muted">It takes every completed ride from that branch, completed in the period, that has a cost and is not on an invoice yet.</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating(false)}>Close</button>
              <button className="btn btn-primary btn-sm" disabled={pending}>Create</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
