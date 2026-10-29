"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertTriangle, Pencil, Plus, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { formatCount, formatRupees, paiseToInput } from "@/lib/inventory/format";
import { inventoryApi } from "./api";

export type ItemView = {
  id: string; name: string; categoryId: string | null; category: string | null; unit: string; quantity: number; minQuantity: number;
  ratePaise: number | null; location: string | null; notes: string | null; active: boolean; low: boolean;
};
type Category = { id: string; name: string };
type Filters = { q: string; categoryId: string; low: boolean; inactive: boolean };

const UNITS = ["Nos", "Box", "Pack", "Ream", "Set", "Pair", "Kg", "Litre", "Metre", "Roll"];

function ItemForm({ item, categories, pending, onSubmit }: { item: ItemView | null; categories: Category[]; pending: boolean; onSubmit: (v: Record<string, unknown>) => void }) {
  const [v, setV] = useState({
    name: item?.name ?? "", categoryId: item?.categoryId ?? "", unit: item?.unit ?? "Nos", quantity: String(item?.quantity ?? 0), minQuantity: String(item?.minQuantity ?? 0),
    rate: paiseToInput(item?.ratePaise), location: item?.location ?? "", notes: item?.notes ?? "", active: item?.active ?? true,
  });
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));
  const field = "block";
  const label = "label-xs mb-1.5 block";
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); onSubmit(v); }}>
      <label className={field}><span className={label}>Name</span><input className="input" value={v.name} onChange={(e) => set("name", e.target.value)} required maxLength={120} autoFocus /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={field}><span className={label}>Category</span>
          <select className="input" value={v.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
            <option value="">No category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        <label className={field}><span className={label}>Unit</span>
          <input className="input" list="inventory-units" value={v.unit} onChange={(e) => set("unit", e.target.value)} required maxLength={20} />
          <datalist id="inventory-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist></label>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className={field}><span className={label}>{item ? "Quantity in stock" : "Opening stock"}</span><input className="input" type="number" min={0} step={1} value={v.quantity} onChange={(e) => set("quantity", e.target.value)} required /></label>
        <label className={field}><span className={label}>Minimum stock</span><input className="input" type="number" min={0} step={1} value={v.minQuantity} onChange={(e) => set("minQuantity", e.target.value)} required /></label>
        <label className={field}><span className={label}>Rate (₹ per unit)</span><input className="input" inputMode="decimal" placeholder="Optional" value={v.rate} onChange={(e) => set("rate", e.target.value)} maxLength={20} /></label>
      </div>
      {item && Number(v.quantity) !== item.quantity && (
        <p className="text-xs text-muted">The change from {item.quantity} to {v.quantity || 0} is saved in the stock history as a recount, under your name.</p>
      )}
      <label className={field}><span className={label}>Location (optional)</span><input className="input" placeholder="Store room, shelf…" value={v.location} onChange={(e) => set("location", e.target.value)} maxLength={120} /></label>
      <label className={field}><span className={label}>Notes (optional)</span><textarea className="input min-h-20" value={v.notes} onChange={(e) => set("notes", e.target.value)} maxLength={500} /></label>
      <label className="flex cursor-pointer items-start gap-2.5">
        <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={v.active} onChange={(e) => set("active", e.target.checked)} />
        <span className="text-sm"><b>Active</b><span className="block text-xs text-muted">Untick to hide it from the catalogue without losing its history.</span></span>
      </label>
      <button className="btn btn-primary btn-sm" disabled={pending}>{item ? "Save" : "Add item"}</button>
    </form>
  );
}

/** The item catalogue. Everyone may look; only an Inventory admin may add, edit or delete. */
export function ItemsView({ items, categories, canEdit, filters }: { items: ItemView[]; categories: Category[]; canEdit: boolean; filters: Filters }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<ItemView | "new" | null>(null);
  const lowCount = items.filter((i) => i.low && i.active).length;

  // Filters live in the address, so a filtered list can be bookmarked or shared.
  const go = (next: Partial<Filters>) => {
    const f = { ...filters, ...next };
    const p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    if (f.categoryId) p.set("category", f.categoryId);
    if (f.low) p.set("low", "1");
    if (f.inactive) p.set("inactive", "1");
    router.replace(`/inventory/items${p.size ? `?${p}` : ""}`);
  };

  const save = (v: Record<string, unknown>) => start(async () => {
    try {
      if (editing === "new") await inventoryApi("/api/inventory/items", "POST", v);
      else if (editing) await inventoryApi(`/api/inventory/items/${editing.id}`, "PATCH", v);
      toast.success(editing === "new" ? "Item added" : "Item saved");
      setEditing(null);
      router.refresh();
    } catch (e) { toast.error((e as Error).message); }
  });

  // Asked before the transition starts: a dialog opened inside one never shows.
  const remove = async (item: ItemView) => {
    if (!(await confirm({ title: "Delete this item?", confirmLabel: "Delete", danger: true,
      message: `“${item.name}” will be removed for good. An item with stock history can't be deleted; untick Active on it instead to hide it.` }))) return;
    start(async () => {
      try { await inventoryApi(`/api/inventory/items/${item.id}`, "DELETE"); toast.success("Item deleted"); router.refresh(); } catch (e) { toast.error((e as Error).message); }
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Items</h1>
          <p className="text-sm text-muted">{formatCount(items.length)} {items.length === 1 ? "item" : "items"}{lowCount > 0 && <> · <span className="font-semibold text-brand-red">{lowCount} low on stock</span></>}</p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Link href="/inventory/categories" className="btn btn-ghost btn-sm">Categories</Link>
            <button className="btn btn-primary btn-sm" onClick={() => setEditing("new")}><Plus size={14} /> Add item</button>
          </div>
        )}
      </div>

      <form className="flex flex-wrap items-center gap-3" onSubmit={(e) => { e.preventDefault(); go({ q: String(new FormData(e.currentTarget).get("q") ?? "") }); }}>
        <input name="q" className="input !w-full sm:!w-64" placeholder="Search items" defaultValue={filters.q} aria-label="Search items" />
        <select className="input !w-auto" value={filters.categoryId} onChange={(e) => go({ categoryId: e.target.value })} aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" className="h-4 w-4" checked={filters.low} onChange={(e) => go({ low: e.target.checked })} /> Low stock only</label>
        {canEdit && <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" className="h-4 w-4" checked={filters.inactive} onChange={(e) => go({ inactive: e.target.checked })} /> Show inactive</label>}
      </form>

      <div className="table-wrap"><table>
        <thead><tr><th>Item</th><th>Category</th><th>Unit</th><th className="text-right">In stock</th><th className="text-right">Minimum</th><th className="text-right">Rate</th>{canEdit && <th className="text-right">Actions</th>}</tr></thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className={`${i.active ? "" : "opacity-60"} ${i.low && i.active ? "bg-[var(--c-red)]/5" : ""}`}>
              <td><b>{i.name}</b>{!i.active && <span className="badge badge-neutral ml-2">Inactive</span>}
                {i.location && <span className="block text-xs text-muted">{i.location}</span>}</td>
              <td>{i.category ?? <span className="text-subtle">—</span>}</td>
              <td>{i.unit}</td>
              <td className={`text-right font-semibold ${i.low ? "text-brand-red" : ""}`}>
                {i.low && <AlertTriangle size={13} className="mr-1 inline align-[-2px]" aria-label="Low on stock" />}{formatCount(i.quantity)}</td>
              <td className="text-right text-muted">{formatCount(i.minQuantity)}</td>
              <td className="text-right">{formatRupees(i.ratePaise)}</td>
              {canEdit && (
                <td><div className="flex justify-end gap-1.5">
                  <button className="chip !p-1.5 text-muted" aria-label={`Edit ${i.name}`} title="Edit" disabled={pending} onClick={() => setEditing(i)}><Pencil size={14} /></button>
                  <button className="chip !p-1.5 text-brand-red" aria-label={`Delete ${i.name}`} title="Delete" disabled={pending} onClick={() => remove(i)}><Trash2 size={14} /></button>
                </div></td>
              )}
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan={canEdit ? 7 : 6} className="text-subtle">{filters.q || filters.categoryId || filters.low ? "No items match." : canEdit ? "No items yet. Add the first one." : "No items yet."}</td></tr>}
        </tbody>
      </table></div>

      {editing && (
        <Modal title={editing === "new" ? "Add item" : `Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <ItemForm item={editing === "new" ? null : editing} categories={categories} pending={pending} onSubmit={save} />
        </Modal>
      )}
    </div>
  );
}
