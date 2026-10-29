"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { inventoryApi } from "./api";

type Category = { id: string; name: string; items: number };

/** Item categories: add, rename, delete. Inventory admin only. */
export function CategoriesView({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  const run = (fn: () => Promise<unknown>, done: string, after?: () => void) => start(async () => {
    try { await fn(); toast.success(done); after?.(); router.refresh(); } catch (e) { toast.error((e as Error).message); }
  });

  // Asked before the transition starts: a dialog opened inside one never shows.
  const remove = async (c: Category) => {
    if (!(await confirm({ title: "Delete this category?", confirmLabel: "Delete", danger: true,
      message: c.items === 0 ? `“${c.name}” has no items and will be removed.` : `“${c.name}” will be removed. Its ${c.items} ${c.items === 1 ? "item stays" : "items stay"} in the catalogue, without a category.` }))) return;
    run(() => inventoryApi(`/api/inventory/categories/${c.id}`, "DELETE"), "Category deleted");
  };

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <Link href="/inventory/items" className="text-sm text-muted hover:text-primary">← Items</Link>
        <h1 className="mt-1 text-2xl">Categories</h1>
        <p className="text-sm text-muted">Group the catalogue. Deleting a category keeps its items.</p>
      </div>

      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => inventoryApi("/api/inventory/categories", "POST", { name }), "Category added", () => setName("")); }}>
        <input className="input" placeholder="New category, e.g. Stationery" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required aria-label="New category name" />
        <button className="btn btn-primary btn-sm shrink-0" disabled={pending || !name.trim()}><Plus size={14} /> Add</button>
      </form>

      <div className="table-wrap"><table>
        <thead><tr><th>Category</th><th className="text-right">Items</th><th className="text-right">Actions</th></tr></thead>
        <tbody>
          {categories.map((c) => (
            <tr key={c.id}>
              <td>{editing?.id === c.id ? (
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => inventoryApi(`/api/inventory/categories/${c.id}`, "PATCH", { name: editing.name }), "Category renamed", () => setEditing(null)); }}>
                  <input className="input !py-1" value={editing.name} onChange={(e) => setEditing({ id: c.id, name: e.target.value })} maxLength={120} required autoFocus aria-label={`New name for ${c.name}`} />
                  <button className="chip !p-1.5 text-primary" aria-label="Save" disabled={pending}><Check size={14} /></button>
                  <button type="button" className="chip !p-1.5 text-muted" aria-label="Cancel" onClick={() => setEditing(null)}><X size={14} /></button>
                </form>
              ) : <b>{c.name}</b>}</td>
              <td className="text-right">{c.items}</td>
              <td><div className="flex justify-end gap-1.5">
                <button className="chip !p-1.5 text-muted" aria-label={`Rename ${c.name}`} title="Rename" disabled={pending} onClick={() => setEditing({ id: c.id, name: c.name })}><Pencil size={14} /></button>
                <button className="chip !p-1.5 text-brand-red" aria-label={`Delete ${c.name}`} title="Delete" disabled={pending} onClick={() => remove(c)}><Trash2 size={14} /></button>
              </div></td>
            </tr>
          ))}
          {categories.length === 0 && <tr><td colSpan={3} className="text-subtle">No categories yet.</td></tr>}
        </tbody>
      </table></div>
    </div>
  );
}
