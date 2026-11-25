"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Download, Pencil, Plus, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import type { AmcRow } from "@/lib/inventory/amc";
import { AMC_TYPES, AMC_TYPE_HINT, AMC_TYPE_LABEL, amcTotals, fyLabel, fyPairLabel, type AmcType } from "@/lib/inventory/amc-shared";
import { AMC_PATH } from "@/lib/inventory/inventory.manifest";
import { paiseToInput } from "@/lib/inventory/format";
import { inventoryApi } from "./api";

type Option = { id: string; name: string };
type Filters = { branch: string; category: string; fy: number; vendor: string };

const money = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
/** 3250000 paise → "32,500"; none → "—". Lakhs are grouped the Indian way: 4,35,499. */
const amount = (paise: number | null) => (paise == null ? "—" : money.format(paise / 100));
const day = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : null);

type FormState = {
  branchId: string; categoryId: string; equipmentService: string; vendorName: string; amcType: AmcType | ""; fyStartYear: number;
  startDate: string; endDate: string; amountCurrentFy: string; amountNextFy: string; notes: string;
};

const blank = (fy: number, branchId: string, categoryId: string): FormState => ({
  branchId, categoryId, equipmentService: "", vendorName: "", amcType: "", fyStartYear: fy, startDate: "", endDate: "", amountCurrentFy: "", amountNextFy: "", notes: "",
});
const fromRow = (r: AmcRow): FormState => ({
  branchId: r.branchId, categoryId: r.categoryId ?? "", equipmentService: r.equipmentService, vendorName: r.vendorName, amcType: r.amcType, fyStartYear: r.fyStartYear,
  startDate: r.startDate ?? "", endDate: r.endDate ?? "", amountCurrentFy: paiseToInput(r.amountCurrentFy), amountNextFy: paiseToInput(r.amountNextFy), notes: r.notes ?? "",
});

function AmcForm({
  row, initial, branches, categories, vendors, years, pending, onSubmit,
}: {
  row: AmcRow | null; initial: FormState; branches: { id: string; name: string; active: boolean }[]; categories: Option[]; vendors: Option[]; years: number[];
  pending: boolean; onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [v, setV] = useState(initial);
  const set = <K extends keyof FormState>(k: K, val: FormState[K]) => setV((s) => ({ ...s, [k]: val }));
  const label = "label-xs mb-1.5 block";
  // Picking a name from the directory links the contract to that vendor; any other name is kept as typed.
  const typed = v.vendorName.trim().toLowerCase();
  const vendorId = vendors.find((x) => x.name.toLowerCase() === typed)?.id ?? (row && v.vendorName === row.vendorName ? row.vendorId : null) ?? "";
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ ...v, vendorId });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={label}>Branch <span className="text-brand-red">*</span></span>
          <select className="input" value={v.branchId} onChange={(e) => set("branchId", e.target.value)} required>
            <option value="">Choose a branch…</option>
            {branches.filter((b) => b.active || b.id === v.branchId).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={label}>Category</span>
          <select className="input" value={v.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
            <option value="">No category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      </div>
      <label className="block">
        <span className={label}>Equipment / service <span className="text-brand-red">*</span></span>
        <input className="input" value={v.equipmentService} onChange={(e) => set("equipmentService", e.target.value)} required maxLength={120} placeholder="e.g. 30 KVA UPS" autoFocus />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={label}>Vendor <span className="text-brand-red">*</span></span>
          <input className="input" list="amc-vendors" value={v.vendorName} onChange={(e) => set("vendorName", e.target.value)} required maxLength={120} placeholder="Pick from the directory or type a name" />
          <datalist id="amc-vendors">{vendors.map((x) => <option key={x.id} value={x.name} />)}</datalist>
        </label>
        <label className="block">
          <span className={label}>AMC type <span className="text-brand-red">*</span></span>
          <select className="input" value={v.amcType} onChange={(e) => set("amcType", e.target.value as AmcType)} required>
            <option value="">Choose the type…</option>
            {AMC_TYPES.map((t) => <option key={t} value={t}>{AMC_TYPE_HINT[t]}</option>)}
          </select>
        </label>
      </div>
      <label className="block">
        <span className={label}>Financial years</span>
        <select className="input" value={v.fyStartYear} onChange={(e) => set("fyStartYear", Number(e.target.value))}>
          {years.map((y) => <option key={y} value={y}>FY {fyPairLabel(y)}</option>)}
        </select>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className={label}>AMC start date</span><input className="input" type="date" value={v.startDate} onChange={(e) => set("startDate", e.target.value)} /></label>
        <label className="block"><span className={label}>AMC end date</span><input className="input" type="date" min={v.startDate || undefined} value={v.endDate} onChange={(e) => set("endDate", e.target.value)} /></label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={label}>Amount FY {fyLabel(v.fyStartYear)} (₹)</span>
          <input className="input" inputMode="decimal" value={v.amountCurrentFy} onChange={(e) => set("amountCurrentFy", e.target.value)} maxLength={20} placeholder="e.g. 32,500" />
        </label>
        <label className="block">
          <span className={label}>Amount FY {fyLabel(v.fyStartYear + 1)} (₹)</span>
          <input className="input" inputMode="decimal" value={v.amountNextFy} onChange={(e) => set("amountNextFy", e.target.value)} maxLength={20} placeholder="e.g. 33,500" />
        </label>
      </div>
      <label className="block"><span className={label}>Notes</span><textarea className="input min-h-20" value={v.notes} onChange={(e) => set("notes", e.target.value)} maxLength={1000} /></label>
      <button className="btn btn-primary btn-sm w-full sm:w-auto" disabled={pending}>{row ? "Save" : "Add AMC"}</button>
    </form>
  );
}

/** Annual Maintenance Contracts: filters, the table with its total, and the add / edit / delete / export controls. Inventory admins only. */
export function AmcView({
  rows, branches, categories, vendors, years, filters,
}: {
  rows: AmcRow[]; branches: { id: string; name: string; active: boolean }[]; categories: Option[]; vendors: Option[]; years: number[]; filters: Filters;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<AmcRow | "new" | null>(null);
  const totals = amcTotals(rows);
  const filtered = !!(filters.branch || filters.category || filters.vendor);
  const exportQuery = new URLSearchParams({ fy: String(filters.fy), ...(filters.branch && { branch: filters.branch }), ...(filters.category && { category: filters.category }), ...(filters.vendor && { vendor: filters.vendor }) });

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
    if (!(await confirm({ title: "Delete this AMC?", confirmLabel: "Delete", danger: true, message: `“${r.equipmentService}” with ${r.vendorName} (${r.branchName}) will be removed for good.` }))) return;
    run(() => inventoryApi(`/api/inventory/amc/${r.id}`, "DELETE"), "AMC deleted");
  };

  const label = "label-xs mb-1.5 block";
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Annual Maintenance Contracts</h1>
          <p className="text-sm text-muted">
            {rows.length} {rows.length === 1 ? "contract" : "contracts"} for FY {fyPairLabel(filters.fy)}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/inventory/amc/export?${exportQuery}`} className="btn btn-ghost btn-sm"><Download size={14} /> Export CSV</a>
          <button className="btn btn-primary btn-sm" onClick={() => setEditing("new")}><Plus size={14} /> Add AMC</button>
        </div>
      </div>

      <form className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]" method="get" action={AMC_PATH}>
        <label className="block">
          <span className={label}>Branch</span>
          <select name="branch" className="input" defaultValue={filters.branch}>
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}{b.active ? "" : " (inactive)"}</option>)}
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
          <span className={label}>Financial year</span>
          <select name="fy" className="input" defaultValue={String(filters.fy)}>
            {years.map((y) => <option key={y} value={y}>FY {fyPairLabel(y)}</option>)}
          </select>
        </label>
        <label className="block">
          <span className={label}>Vendor</span>
          <input name="vendor" className="input" list="amc-filter-vendors" defaultValue={filters.vendor} placeholder="Search or choose a vendor" maxLength={100} />
          <datalist id="amc-filter-vendors">{vendors.map((v) => <option key={v.id} value={v.name} />)}</datalist>
        </label>
        <div className="flex gap-2">
          <button className="btn btn-primary btn-sm">Show</button>
          {filtered && <Link href={`${AMC_PATH}?fy=${filters.fy}`} className="btn btn-ghost btn-sm">Clear</Link>}
        </div>
      </form>

      <div className="table-wrap">
        <table className="min-w-[860px]">
          <thead>
            <tr>
              <th>Sr. No.</th>
              <th>Equipment / Service</th>
              <th>Vendor Recommended</th>
              <th>AMC Type</th>
              <th className="text-right">AMC Amount FY {fyLabel(filters.fy)} (₹)</th>
              <th className="text-right">AMC Amount FY {fyLabel(filters.fy + 1)} (₹)</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const period = r.startDate || r.endDate ? `${day(r.startDate) ?? "…"} – ${day(r.endDate) ?? "…"}` : null;
              return (
                <tr key={r.id}>
                  <td className="text-muted">{i + 1}</td>
                  <td>
                    <b>{r.equipmentService}</b>
                    <span className="block text-xs text-muted">{r.branchName}{r.categoryName ? ` · ${r.categoryName}` : ""}</span>
                    {r.notes && <span className="block max-w-xs whitespace-pre-line text-xs text-subtle">{r.notes}</span>}
                  </td>
                  <td>{r.vendorName}</td>
                  <td>
                    <span className="badge badge-neutral whitespace-nowrap" title={AMC_TYPE_HINT[r.amcType]}>{AMC_TYPE_LABEL[r.amcType]}</span>
                    {period && <span className="mt-1 block whitespace-nowrap text-xs text-muted">{period}</span>}
                  </td>
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
            {rows.length === 0 && <tr><td colSpan={7} className="text-subtle">{filtered ? "No contracts match." : `No contracts for FY ${fyPairLabel(filters.fy)} yet. Add the first one.`}</td></tr>}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="bg-alt font-bold">
                <td colSpan={4} className="border-t border-border text-right">Total</td>
                <td className="border-t border-border text-right tabular-nums" data-testid="amc-total-current">{amount(totals.current)}</td>
                <td className="border-t border-border text-right tabular-nums" data-testid="amc-total-next">{amount(totals.next)}</td>
                <td className="border-t border-border" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {editing && (
        <Modal title={editing === "new" ? "Add AMC" : `Edit ${editing.equipmentService}`} onClose={() => setEditing(null)}>
          <AmcForm
            row={editing === "new" ? null : editing}
            initial={editing === "new" ? blank(filters.fy, filters.branch, filters.category) : fromRow(editing)}
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
