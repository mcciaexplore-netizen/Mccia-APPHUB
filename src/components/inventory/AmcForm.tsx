"use client";

import { useState } from "react";
import type { AmcRow } from "@/lib/inventory/amc";
import { AMC_TYPES, AMC_TYPE_HINT, fyLabel, fyPairLabel, type AmcType } from "@/lib/inventory/amc-shared";
import { paiseToInput } from "@/lib/inventory/format";

export type AmcOption = { id: string; name: string };
export type AmcBranchOption = { id: string; name: string; active: boolean };

export type AmcFormState = {
  branchId: string; categoryId: string; equipmentService: string; vendorName: string; amcType: AmcType | ""; fyStartYear: number;
  startDate: string; endDate: string; amountCurrentFy: string; amountNextFy: string; notes: string;
};

export const blankAmc = (fy: number, branchId: string, categoryId = ""): AmcFormState => ({
  branchId, categoryId, equipmentService: "", vendorName: "", amcType: "", fyStartYear: fy, startDate: "", endDate: "", amountCurrentFy: "", amountNextFy: "", notes: "",
});
export const amcFromRow = (r: AmcRow): AmcFormState => ({
  branchId: r.branchId, categoryId: r.categoryId ?? "", equipmentService: r.equipmentService, vendorName: r.vendorName, amcType: r.amcType, fyStartYear: r.fyStartYear,
  startDate: r.startDate ?? "", endDate: r.endDate ?? "", amountCurrentFy: paiseToInput(r.amountCurrentFy), amountNextFy: paiseToInput(r.amountNextFy), notes: r.notes ?? "",
});

/**
 * The add / edit form for one contract (shown in a dialog). The vendor is typed or picked from the directory (a name that matches a
 * directory vendor links the contract to it); the two amount labels follow the financial years chosen. Full width on a phone.
 */
export function AmcForm({
  row, initial, branches, categories, vendors, years, pending, onSubmit,
}: {
  row: AmcRow | null; initial: AmcFormState; branches: AmcBranchOption[]; categories: AmcOption[]; vendors: AmcOption[]; years: number[];
  pending: boolean; onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [v, setV] = useState(initial);
  const set = <K extends keyof AmcFormState>(k: K, val: AmcFormState[K]) => setV((s) => ({ ...s, [k]: val }));
  const label = "label-xs mb-1.5 block";
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
