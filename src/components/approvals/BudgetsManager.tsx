"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { api, useAction } from "@/components/approvals/api";
import { Field, SearchBox } from "@/components/approvals/ui";
import type { BudgetRow } from "@/lib/approvals/budgets";
import { formatINR, parseINR } from "@/lib/approvals/format";

type Opt = { id: string; name: string };

/** Budgets per financial year, branch and category. Everyone allowed on this page can read it; only an Approvals admin can change it. */
export function BudgetsManager({ rows, branches, categories, years, year, canEdit }: {
  rows: BudgetRow[]; branches: Opt[]; categories: Opt[]; years: string[]; year: string; canEdit: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const confirm = useConfirm();
  const toast = useToast();
  const { run, pending } = useAction();

  const [q, setQ] = useState("");
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [edit, setEdit] = useState<BudgetRow | null>(null);

  const needle = q.trim().toLowerCase();
  const shown = rows.filter((r) => !needle || r.branchName.toLowerCase().includes(needle) || r.categoryName.toLowerCase().includes(needle));
  const total = shown.reduce((sum, r) => sum + r.allocatedPaise, 0);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const paise = parseINR(amount);
    if (paise === null) return toast.error("Enter the budget as an amount like 12,34,567.00");
    run(() => api("POST", "/api/approvals/budgets", { financialYear: year, branchId, categoryId, allocatedPaise: paise }), "Budget saved", () => setAmount(""));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Financial year">
          <select aria-label="Financial year" className="input w-40" value={year} onChange={(e) => router.push(`${pathname}?fy=${e.target.value}`)}>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </Field>
        <SearchBox value={q} onChange={setQ} placeholder="Search branch or category" />
      </div>

      {canEdit && (
        <form onSubmit={save} className="glass flex flex-wrap items-end gap-3 !rounded-md p-4">
          <Field label="Branch">
            <select aria-label="Branch" className="input min-w-44" value={branchId} onChange={(e) => setBranchId(e.target.value)} required>
              {branches.length === 0 && <option value="">Add a branch first</option>}
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Category">
            <select aria-label="Category" className="input min-w-56" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label={`Budget for ${year}`}>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-subtle">{"₹"}</span>
              <input className="input w-48 !pl-8" inputMode="decimal" placeholder="##,##,###.##" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
          </Field>
          <button className="btn btn-primary btn-sm" disabled={pending || !branchId || !categoryId}>Save budget</button>
          <p className="basis-full text-xs text-subtle">Saving again for the same branch and category replaces the amount.</p>
        </form>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Branch</th><th>Category</th><th className="text-right">Allocated ({"₹"})</th>
              {canEdit && <th className="w-32 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-sm text-subtle">No budgets set for {year} yet.</td></tr>}
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="font-medium">{r.branchName}</td>
                <td>{r.categoryName}</td>
                <td className="text-right tabular-nums">{formatINR(r.allocatedPaise)}</td>
                {canEdit && (
                  <td>
                    <div className="flex justify-end gap-2">
                      <button className="chip flex items-center gap-1 text-muted" onClick={() => setEdit(r)}><Pencil size={13} /> Edit</button>
                      <button
                        className="chip text-brand-red" aria-label={`Remove budget for ${r.branchName}, ${r.categoryName}`}
                        onClick={async () => {
                          if (await confirm({ title: "Remove this budget?", message: `${r.branchName} / ${r.categoryName} for ${r.financialYear} goes back to no budget set.`, confirmLabel: "Remove", danger: true })) {
                            run(() => api("DELETE", `/api/approvals/budgets/${r.id}`), "Budget removed");
                          }
                        }}
                      ><Trash2 size={13} /></button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          {shown.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={2} className="border-t border-line px-4 py-3 text-xs font-bold uppercase tracking-wider text-subtle">Total allocated</td>
                <td className="border-t border-line px-4 py-3 text-right font-semibold tabular-nums">{formatINR(total)}</td>
                {canEdit && <td className="border-t border-line" />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {edit && <EditBudget row={edit} pending={pending} onClose={() => setEdit(null)} onSave={(paise) => run(() => api("PATCH", `/api/approvals/budgets/${edit.id}`, { allocatedPaise: paise }), "Budget saved", () => setEdit(null))} />}
    </div>
  );
}

function EditBudget({ row, pending, onClose, onSave }: { row: BudgetRow; pending: boolean; onClose: () => void; onSave: (paise: number) => void }) {
  const toast = useToast();
  const [amount, setAmount] = useState(formatINR(row.allocatedPaise));
  return (
    <Modal title="Change budget" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const paise = parseINR(amount);
          if (paise === null) toast.error("Enter the budget as an amount like 12,34,567.00");
          else onSave(paise);
        }}
      >
        <p className="text-sm text-muted">{row.branchName} / {row.categoryName} / {row.financialYear}</p>
        <Field label="Allocated">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-subtle">{"₹"}</span>
            <input className="input !pl-8" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
        </Field>
        <div className="flex justify-end gap-3">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" disabled={pending}>Save</button>
        </div>
      </form>
    </Modal>
  );
}
