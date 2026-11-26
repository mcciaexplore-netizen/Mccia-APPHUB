"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, ChevronDown, ClipboardList, Download, Pencil, Plus, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import type { AmcRow } from "@/lib/inventory/amc";
import { AMC_TYPE_HINT, AMC_TYPE_LABEL, amcTotals, fyLabel, fyPairLabel, groupAmc, type AmcType } from "@/lib/inventory/amc-shared";
import { AMC_PATH } from "@/lib/inventory/inventory.manifest";
import { AmcForm, amcFromRow, blankAmc, type AmcBranchOption, type AmcOption } from "./AmcForm";
import { inventoryApi } from "./api";

type Filters = { fy: number; category: string; vendor: string };

const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
/** 3250000 paise → "32,500"; none → "—". Lakhs are grouped the Indian way: 4,35,499. */
const amount = (paise: number | null) => (paise == null ? "—" : money.format(paise / 100));
const day = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null);

/**
 * One branch's Annual Maintenance Contracts, grouped by type (Non-Comprehensive, Comprehensive, Service, CEC, Labour). Each group is a
 * collapsible heading with its count, a table and a subtotal; a type with no contracts has no group. Inventory admins only.
 */
export function AmcBranchView({
  branch, rows, branches, categories, vendors, years, filters,
}: {
  branch: { id: string; name: string }; rows: AmcRow[]; branches: AmcBranchOption[]; categories: AmcOption[]; vendors: AmcOption[]; years: number[]; filters: Filters;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<AmcRow | "new" | null>(null);
  // The groups the person has closed; every group starts open.
  const [closed, setClosed] = useState<Set<AmcType>>(new Set());
  const groups = groupAmc(rows);
  const totals = amcTotals(rows);
  const filtered = !!(filters.category || filters.vendor);
  const path = `${AMC_PATH}/${branch.id}`;
  const exportQuery = new URLSearchParams({ branch: branch.id, fy: String(filters.fy), ...(filters.category && { category: filters.category }), ...(filters.vendor && { vendor: filters.vendor }) });
  const fy1 = `FY ${fyLabel(filters.fy)}`;
  const fy2 = `FY ${fyLabel(filters.fy + 1)}`;

  const toggle = (t: AmcType) => setClosed((c) => { const n = new Set(c); if (n.has(t)) n.delete(t); else n.add(t); return n; });
  const run = (fn: () => Promise<unknown>, done: string, after?: () => void) =>
    start(async () => {
      try {
        await fn();
        toast.success(done);
        after?.();
        router.refresh();
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  const save = (body: Record<string, unknown>) =>
    run(() => (editing === "new" ? inventoryApi("/api/inventory/amc", "POST", body) : inventoryApi(`/api/inventory/amc/${(editing as AmcRow).id}`, "PATCH", body)), editing === "new" ? "AMC added" : "AMC saved", () => setEditing(null));
  // Asked before the transition starts: a dialog opened inside one never shows.
  const remove = async (r: AmcRow) => {
    if (!(await confirm({ title: "Delete this AMC?", confirmLabel: "Delete", danger: true, message: `“${r.equipmentService}” with ${r.vendorName} will be removed for good.` }))) return;
    run(() => inventoryApi(`/api/inventory/amc/${r.id}`, "DELETE"), "AMC deleted");
  };

  const label = "label-xs mb-1.5 block";
  return (
    <div className="space-y-5">
      <Link href={AMC_PATH} className="inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-primary hover:underline"><ArrowLeft size={15} aria-hidden /> All branches</Link>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">{branch.name}</h1>
          <p className="text-sm text-muted" data-testid="amc-branch-summary">
            {rows.length} {rows.length === 1 ? "AMC" : "AMCs"}
            {rows.length > 0 && <> · {fy1}: <b className="text-ink">₹{amount(totals.current)}</b> · {fy2}: <b className="text-ink">₹{amount(totals.next)}</b></>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/inventory/amc/export?${exportQuery}`} className="btn btn-ghost btn-sm"><Download size={14} /> Export CSV</a>
          <button className="btn btn-primary btn-sm" onClick={() => setEditing("new")}><Plus size={14} /> Add AMC</button>
        </div>
      </div>

      <form className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto]" method="get" action={path}>
        <label className="block">
          <span className={label}>Financial year</span>
          <select name="fy" className="input" defaultValue={String(filters.fy)}>
            {years.map((y) => <option key={y} value={y}>FY {fyPairLabel(y)}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={label}>Category</span>
          <select name="category" className="input" defaultValue={filters.category}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={label}>Vendor</span>
          <input name="vendor" className="input" list="amc-filter-vendors" defaultValue={filters.vendor} placeholder="Search or choose a vendor" maxLength={100} />
          <datalist id="amc-filter-vendors">{vendors.map((v) => <option key={v.id} value={v.name} />)}</datalist>
        </label>
        <div className="flex gap-2">
          <button className="btn btn-primary btn-sm">Show</button>
          {filtered && <Link href={`${path}?fy=${filters.fy}`} className="btn btn-ghost btn-sm">Clear</Link>}
        </div>
      </form>

      {groups.length === 0 && (
        <p className="rounded-[14px] border border-gray-200 bg-white px-5 py-8 text-center text-sm text-subtle">
          {filtered ? "No contracts match." : `${branch.name} has no contracts for FY ${fyPairLabel(filters.fy)} yet. Add the first one.`}
        </p>
      )}

      {groups.map((g) => {
        const open = !closed.has(g.type);
        const id = `amc-group-${g.type}`;
        return (
          <section key={g.type} className="space-y-2" data-testid={`amc-group-${g.type}`}>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={id}
              onClick={() => toggle(g.type)}
              className="flex min-h-11 w-full items-center gap-2 rounded-[14px] border border-gray-200 bg-white px-4 py-2 text-left hover:bg-alt"
            >
              <ClipboardList size={16} aria-hidden className="shrink-0 text-primary" />
              <span className="flex-1 font-bold text-ink" title={AMC_TYPE_HINT[g.type]}>
                {AMC_TYPE_LABEL[g.type]} <span className="font-semibold text-muted">({g.rows.length})</span>
              </span>
              {/* A closed group still shows what it adds up to. */}
              {!open && <span className="hidden text-xs text-muted tabular-nums sm:inline">{fy1} ₹{amount(g.totals.current)} · {fy2} ₹{amount(g.totals.next)}</span>}
              <ChevronDown size={16} aria-hidden className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open && (
              <div className="table-wrap" id={id}>
                <table className="min-w-[640px]">
                  <thead>
                    <tr>
                      <th>Equipment / Service</th>
                      <th>Vendor</th>
                      <th className="text-right">{fyLabel(filters.fy)} (₹)</th>
                      <th className="text-right">{fyLabel(filters.fy + 1)} (₹)</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.rows.map((r) => {
                      const period = r.startDate || r.endDate ? `${day(r.startDate) ?? "…"} – ${day(r.endDate) ?? "…"}` : null;
                      return (
                        <tr key={r.id}>
                          <td>
                            <b>{r.equipmentService}</b>
                            {r.categoryName && <span className="block text-xs text-muted">{r.categoryName}</span>}
                            {period && <span className="block whitespace-nowrap text-xs text-muted">{period}</span>}
                            {r.notes && <span className="block max-w-xs whitespace-pre-line text-xs text-subtle">{r.notes}</span>}
                          </td>
                          <td>{r.vendorName}</td>
                          <td className="text-right tabular-nums">{amount(r.amountCurrentFy)}</td>
                          <td className="text-right tabular-nums">{amount(r.amountNextFy)}</td>
                          <td>
                            <div className="flex justify-end gap-1.5">
                              <button className="chip !p-1.5 text-muted" aria-label={`Edit ${r.equipmentService}`} title="Edit" disabled={pending} onClick={() => setEditing(r)}><Pencil size={14} /></button>
                              <button className="chip !p-1.5 text-brand-red" aria-label={`Delete ${r.equipmentService}`} title="Delete" disabled={pending} onClick={() => remove(r)}><Trash2 size={14} /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-alt font-bold">
                      <td colSpan={2} className="border-t border-border text-right">Subtotal</td>
                      <td className="border-t border-border text-right tabular-nums" data-testid={`amc-subtotal-${g.type}-current`}>{amount(g.totals.current)}</td>
                      <td className="border-t border-border text-right tabular-nums" data-testid={`amc-subtotal-${g.type}-next`}>{amount(g.totals.next)}</td>
                      <td className="border-t border-border" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>
        );
      })}

      {editing && (
        <Modal title={editing === "new" ? `Add AMC · ${branch.name}` : `Edit ${editing.equipmentService}`} onClose={() => setEditing(null)}>
          <AmcForm
            row={editing === "new" ? null : editing}
            initial={editing === "new" ? blankAmc(filters.fy, branch.id, filters.category) : amcFromRow(editing)}
            branches={branches}
            categories={categories}
            vendors={vendors}
            years={years}
            pending={pending}
            onSubmit={save}
          />
        </Modal>
      )}
    </div>
  );
}
