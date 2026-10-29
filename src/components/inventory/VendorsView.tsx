"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { EyeOff, Eye, Pencil, Plus, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { inventoryApi } from "./api";

export type VendorView = {
  id: string; name: string; email: string | null; phone: string | null; address: string | null; gstin: string | null; pan: string | null; active: boolean; inUse: boolean;
};

const toBody = (v: VendorView, active = v.active) => ({ name: v.name, email: v.email ?? "", phone: v.phone ?? "", address: v.address ?? "", gstin: v.gstin ?? "", pan: v.pan ?? "", active });

function VendorForm({ vendor, pending, onSubmit }: { vendor: VendorView | null; pending: boolean; onSubmit: (v: Record<string, unknown>) => void }) {
  const [v, setV] = useState(vendor ? toBody(vendor) : { name: "", email: "", phone: "", address: "", gstin: "", pan: "", active: true });
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));
  const label = "label-xs mb-1.5 block";
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSubmit(v); }}>
      <label className="block"><span className={label}>Name</span><input className="input" value={v.name} onChange={(e) => set("name", e.target.value)} required maxLength={120} autoFocus /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className={label}>Email</span><input className="input" type="email" value={v.email} onChange={(e) => set("email", e.target.value)} maxLength={200} /></label>
        <label className="block"><span className={label}>Phone</span><input className="input" type="tel" value={v.phone} onChange={(e) => set("phone", e.target.value)} maxLength={40} /></label>
      </div>
      <label className="block"><span className={label}>Address</span><textarea className="input min-h-16" value={v.address} onChange={(e) => set("address", e.target.value)} maxLength={500} /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className={label}>GSTIN</span><input className="input font-mono uppercase" placeholder="27ABCDE1234F1Z5" value={v.gstin} onChange={(e) => set("gstin", e.target.value)} maxLength={20} /></label>
        <label className="block"><span className={label}>PAN</span><input className="input font-mono uppercase" placeholder="ABCDE1234F" value={v.pan} onChange={(e) => set("pan", e.target.value)} maxLength={15} /></label>
      </div>
      <label className="flex cursor-pointer items-start gap-2.5">
        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={v.active} onChange={(e) => set("active", e.target.checked)} />
        <span className="text-sm"><b>Active</b><span className="block text-xs text-muted">Untick to hide it from new purchase orders while keeping its records.</span></span>
      </label>
      <button className="btn btn-primary btn-sm" disabled={pending}>{vendor ? "Save" : "Add vendor"}</button>
    </form>
  );
}

/** The vendor directory. Everyone may look; an Inventory admin adds, edits, deactivates and deletes (an unused vendor only). */
export function VendorsView({ vendors, canEdit, filters }: { vendors: VendorView[]; canEdit: boolean; filters: { q: string; inactive: boolean } }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<VendorView | "new" | null>(null);

  const go = (next: Partial<typeof filters>) => {
    const f = { ...filters, ...next };
    const p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    if (f.inactive) p.set("inactive", "1");
    router.replace(`/inventory/vendors${p.size ? `?${p}` : ""}`);
  };
  const run = (fn: () => Promise<unknown>, done: string, after?: () => void) => start(async () => {
    try { await fn(); toast.success(done); after?.(); router.refresh(); } catch (e) { toast.error((e as Error).message); }
  });
  const save = (v: Record<string, unknown>) =>
    run(() => (editing === "new" ? inventoryApi("/api/inventory/vendors", "POST", v) : inventoryApi(`/api/inventory/vendors/${(editing as VendorView).id}`, "PATCH", v)),
      editing === "new" ? "Vendor added" : "Vendor saved", () => setEditing(null));
  const toggle = (v: VendorView) => run(() => inventoryApi(`/api/inventory/vendors/${v.id}`, "PATCH", toBody(v, !v.active)), v.active ? "Vendor deactivated" : "Vendor active again");
  // Asked before the transition starts: a dialog opened inside one never shows.
  const remove = async (v: VendorView) => {
    if (!(await confirm({ title: "Delete this vendor?", confirmLabel: "Delete", danger: true, message: `“${v.name}” will be removed for good.` }))) return;
    run(() => inventoryApi(`/api/inventory/vendors/${v.id}`, "DELETE"), "Vendor deleted");
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Vendors</h1>
          <p className="text-sm text-muted">{vendors.length} {vendors.length === 1 ? "vendor" : "vendors"}. The suppliers purchase orders are sent to.</p>
        </div>
        {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setEditing("new")}><Plus size={14} /> Add vendor</button>}
      </div>

      <form className="flex flex-wrap items-center gap-3" onSubmit={(e) => { e.preventDefault(); go({ q: String(new FormData(e.currentTarget).get("q") ?? "") }); }}>
        <input name="q" className="input !w-full sm:!w-72" placeholder="Search name, email, phone or GSTIN" defaultValue={filters.q} aria-label="Search vendors" />
        <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" className="h-4 w-4" checked={filters.inactive} onChange={(e) => go({ inactive: e.target.checked })} /> Show inactive</label>
      </form>

      <div className="table-wrap"><table>
        <thead><tr><th>Vendor</th><th>Contact</th><th>GSTIN</th><th>PAN</th>{canEdit && <th className="text-right">Actions</th>}</tr></thead>
        <tbody>
          {vendors.map((v) => (
            <tr key={v.id} className={v.active ? "" : "opacity-60"}>
              <td><b>{v.name}</b>{!v.active && <span className="badge badge-neutral ml-2">Inactive</span>}
                {v.address && <span className="block max-w-xs whitespace-pre-line text-xs text-muted">{v.address}</span>}</td>
              <td className="text-sm">{v.email && <a href={`mailto:${v.email}`} className="block text-primary hover:underline">{v.email}</a>}{v.phone && <span className="block text-muted">{v.phone}</span>}
                {!v.email && !v.phone && <span className="text-subtle">—</span>}</td>
              <td className="font-mono text-xs">{v.gstin ?? <span className="text-subtle">—</span>}</td>
              <td className="font-mono text-xs">{v.pan ?? <span className="text-subtle">—</span>}</td>
              {canEdit && (
                <td><div className="flex justify-end gap-1.5">
                  <button className="chip !p-1.5 text-muted" aria-label={`Edit ${v.name}`} title="Edit" disabled={pending} onClick={() => setEditing(v)}><Pencil size={14} /></button>
                  <button className="chip !p-1.5 text-muted" aria-label={`${v.active ? "Deactivate" : "Activate"} ${v.name}`} title={v.active ? "Deactivate" : "Activate"} disabled={pending} onClick={() => toggle(v)}>
                    {v.active ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                  {!v.inUse && <button className="chip !p-1.5 text-brand-red" aria-label={`Delete ${v.name}`} title="Delete" disabled={pending} onClick={() => remove(v)}><Trash2 size={14} /></button>}
                </div></td>
              )}
            </tr>
          ))}
          {vendors.length === 0 && <tr><td colSpan={canEdit ? 5 : 4} className="text-subtle">{filters.q ? "No vendors match." : canEdit ? "No vendors yet. Add the first one." : "No vendors yet."}</td></tr>}
        </tbody>
      </table></div>

      {editing && (
        <Modal title={editing === "new" ? "Add vendor" : `Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <VendorForm vendor={editing === "new" ? null : editing} pending={pending} onSubmit={save} />
        </Modal>
      )}
    </div>
  );
}
