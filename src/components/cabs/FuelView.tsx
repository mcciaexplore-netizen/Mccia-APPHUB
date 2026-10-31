"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Download, Fuel, Plus, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { formatIST } from "@/lib/format";
import { formatRupees } from "@/lib/cabs/money";
import { cabsApi } from "./api";

export type FuelView = { id: string; vehiclePlate: string; litres: string; costPaise: number; fuelledAt: string; stationName: string | null; recordedByName: string };
type VehicleOption = { id: string; numberPlate: string; model: string };
type Form = { vehicleId: string; fuelledAt: string; litres: string; cost: string; stationName: string };

/**
 * Fuel Costs, on Payments: fuel bought for the vehicles, newest first, with this month's total. Add Fuel Cost records one (vehicle, date
 * and time, litres, cost, petrol station; "added by" is whoever is signed in); a record entered by mistake can be deleted.
 */
export function FuelView({ records, vehicles, month, nowLocal, adminName }: {
  records: FuelView[]; vehicles: VehicleOption[]; month: { costPaise: number; litres: number }; nowLocal: string; adminName: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const empty: Form = { vehicleId: "", fuelledAt: nowLocal, litres: "", cost: "", stationName: "" };
  const [form, setForm] = useState<Form>(empty);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const run = (fn: () => Promise<unknown>, done: string, after?: () => void) => start(async () => {
    try { await fn(); toast.success(done); after?.(); router.refresh(); } catch (e) { toast.error((e as Error).message); }
  });
  const remove = async (r: FuelView) => {
    if (!(await confirm({ title: "Delete this fuel record?", message: `${r.vehiclePlate}: ${r.litres} L, ${formatRupees(r.costPaise)}. It stays in the audit log.`, confirmLabel: "Delete", danger: true }))) return;
    run(() => cabsApi(`/api/cabs/fuel/${r.id}`, "DELETE"), "Fuel record deleted");
  };
  return (
    <section className="space-y-3" aria-labelledby="fuel-heading" data-fuel>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 id="fuel-heading" className="flex items-center gap-2 text-lg"><Fuel size={18} aria-hidden /> Fuel Costs</h2>
          <p className="text-sm text-muted" data-fuel-month>This month: {formatRupees(month.costPaise)} for {month.litres.toLocaleString("en-IN", { maximumFractionDigits: 2 })} L</p></div>
        <div className="flex gap-2">
          <a href={"/api/cabs/fuel/export"} download className="btn btn-ghost btn-sm"><Download size={14} /> Export CSV</a>
          <button className="btn btn-primary btn-sm" onClick={() => { setForm(empty); setAdding(true); }}><Plus size={14} /> Add Fuel Cost</button>
        </div>
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Date</th><th>Vehicle</th><th className="text-right">Litres</th><th className="text-right">Cost</th><th>Petrol station</th><th>Added by</th><th className="text-right">Actions</th></tr></thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id} data-fuel-row={r.id}>
              <td className="whitespace-nowrap text-xs text-muted">{formatIST(r.fuelledAt)}</td>
              <td><b>{r.vehiclePlate}</b></td>
              <td className="text-right">{r.litres}</td>
              <td className="text-right">{formatRupees(r.costPaise)}</td>
              <td>{r.stationName ?? <span className="text-subtle">—</span>}</td>
              <td className="text-sm">{r.recordedByName}</td>
              <td><div className="flex justify-end"><button className="btn btn-ghost btn-sm text-brand-red" disabled={pending} onClick={() => remove(r)}><Trash2 size={14} /> Delete</button></div></td>
            </tr>
          ))}
          {records.length === 0 && <tr><td colSpan={7} className="text-subtle">No fuel recorded yet.</td></tr>}
        </tbody>
      </table></div>
      {adding && (
        <Modal title="Add fuel cost" onClose={() => setAdding(false)}>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => cabsApi("/api/cabs/fuel", "POST", form), "Fuel cost recorded", () => setAdding(false)); }}>
            <label className="block"><span className="label-xs mb-1.5 block">Vehicle</span>
              <select className="input" name="vehicleId" value={form.vehicleId} onChange={set("vehicleId")} required autoFocus>
                <option value="">Choose an active vehicle</option>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.numberPlate} · {v.model}</option>)}
              </select></label>
            <label className="block"><span className="label-xs mb-1.5 block">Date and time</span>
              <input className="input" type="datetime-local" name="fuelledAt" value={form.fuelledAt} max={nowLocal} onChange={set("fuelledAt")} required /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="label-xs mb-1.5 block">Litres filled</span>
                <input className="input" name="litres" inputMode="decimal" placeholder="35.5" value={form.litres} onChange={set("litres")} required /></label>
              <label className="block"><span className="label-xs mb-1.5 block">Cost (₹)</span>
                <input className="input" name="cost" inputMode="decimal" placeholder="3,550" value={form.cost} onChange={set("cost")} required /></label>
            </div>
            <label className="block"><span className="label-xs mb-1.5 block">Petrol station (optional)</span>
              <input className="input" name="stationName" maxLength={120} value={form.stationName} onChange={set("stationName")} /></label>
            <p className="text-xs text-muted">Added by <b>{adminName}</b>.</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>Close</button>
              <button className="btn btn-primary btn-sm" disabled={pending}>Add fuel cost</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
