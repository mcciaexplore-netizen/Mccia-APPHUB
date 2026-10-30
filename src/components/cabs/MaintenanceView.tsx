"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { formatIST } from "@/lib/format";
import { MAINTENANCE_LABEL, MAINTENANCE_TYPES, type MaintenanceType } from "@/lib/cabs/cabs.manifest";
import { formatRupees, paiseToRupees } from "@/lib/cabs/money";
import { cabsApi } from "./api";

export type MaintenanceView = {
  id: string; vehicleId: string; vehiclePlate: string; type: MaintenanceType; description: string; costPaise: number | null; doneAt: string; doneBy: string;
  nextDueAt: string | null; notes: string | null; recordedByName: string;
};
type VehicleOption = { id: string; numberPlate: string; model: string; isActive: boolean };
type Form = { vehicleId: string; type: MaintenanceType | ""; description: string; cost: string; doneAt: string; doneBy: string; nextDueAt: string; notes: string };

/** The day in India ("YYYY-MM-DD") of an ISO time, for a date box. */
const istDay = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3600_000).toISOString().slice(0, 10);
const TYPE_TONE: Record<MaintenanceType, string> = {
  service: "bg-blue-tint text-primary", repair: "bg-red-tint text-brand-red", inspection: "bg-[#e8f1fa] text-[#0b63ad]", cleaning: "bg-green-tint text-brand-green-text", other: "bg-alt text-muted",
};
export const TypeBadge = ({ type }: { type: MaintenanceType }) => <span className={`inline-block rounded-pill px-2.5 py-0.5 text-xs font-semibold ${TYPE_TONE[type] ?? TYPE_TONE.other}`}>{MAINTENANCE_LABEL[type] ?? type}</span>;

/** Maintenance records: add, edit, delete. A next due date that has passed is shown in red. */
export function MaintenanceView({ records, vehicles, today }: { records: MaintenanceView[]; vehicles: VehicleOption[]; today: string }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<MaintenanceView | "new" | null>(null);
  const [form, setForm] = useState<Form>({ vehicleId: "", type: "", description: "", cost: "", doneAt: today, doneBy: "", nextDueAt: "", notes: "" });
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const run = (fn: () => Promise<unknown>, done: string, after?: () => void) => start(async () => {
    try { await fn(); toast.success(done); after?.(); router.refresh(); } catch (e) { toast.error((e as Error).message); }
  });
  const open = (r: MaintenanceView | "new") => {
    setForm(r === "new" ? { vehicleId: "", type: "", description: "", cost: "", doneAt: today, doneBy: "", nextDueAt: "", notes: "" }
      : { vehicleId: r.vehicleId, type: r.type, description: r.description, cost: paiseToRupees(r.costPaise), doneAt: istDay(r.doneAt), doneBy: r.doneBy, nextDueAt: r.nextDueAt ? istDay(r.nextDueAt) : "", notes: r.notes ?? "" });
    setEditing(r);
  };
  const remove = async (r: MaintenanceView) => {
    if (!(await confirm({ title: "Delete this record?", message: `${r.vehiclePlate}: ${r.description}. This can't be undone.`, confirmLabel: "Delete", danger: true }))) return;
    run(() => cabsApi(`/api/cabs/maintenance/${r.id}`, "DELETE"), "Record deleted");
  };
  const choices = editing && editing !== "new" ? vehicles.filter((v) => v.isActive || v.id === editing.vehicleId) : vehicles.filter((v) => v.isActive);
  return (
    <div className="space-y-4">
      <div className="table-wrap"><table>
        <thead><tr><th>Vehicle</th><th>Type</th><th>Description</th><th className="text-right">Cost</th><th>Done</th><th>Done by</th><th>Next due</th><th className="text-right">Actions</th></tr></thead>
        <tbody>
          {records.map((r) => {
            const overdue = !!r.nextDueAt && istDay(r.nextDueAt) < today;
            return (
              <tr key={r.id} data-maintenance={r.id}>
                <td><b>{r.vehiclePlate}</b></td>
                <td><TypeBadge type={r.type} /></td>
                <td>{r.description}{r.notes && <span className="block max-w-xs text-xs text-muted">{r.notes}</span>}</td>
                <td className="text-right">{formatRupees(r.costPaise)}</td>
                <td className="whitespace-nowrap text-xs text-muted">{formatIST(r.doneAt).split(",")[0]}</td>
                <td>{r.doneBy}</td>
                <td className={`whitespace-nowrap text-xs ${overdue ? "font-bold text-brand-red" : "text-muted"}`} data-overdue={overdue || undefined}>{r.nextDueAt ? `${formatIST(r.nextDueAt).split(",")[0]}${overdue ? " · overdue" : ""}` : "—"}</td>
                <td><div className="flex justify-end gap-1.5">
                  <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => open(r)}><Pencil size={14} /> Edit</button>
                  <button className="btn btn-ghost btn-sm text-brand-red" disabled={pending} onClick={() => remove(r)} aria-label={`Delete ${r.description}`}><Trash2 size={14} /></button>
                </div></td>
              </tr>
            );
          })}
          {records.length === 0 && <tr><td colSpan={8} className="text-subtle">No maintenance recorded.</td></tr>}
        </tbody>
      </table></div>
      <button className="btn btn-primary btn-sm" onClick={() => open("new")} data-add-maintenance><Plus size={14} /> Add Maintenance Record</button>
      {editing && (
        <Modal title={editing === "new" ? "Add maintenance record" : "Edit maintenance record"} onClose={() => setEditing(null)}>
          <form className="space-y-4" onSubmit={(e) => {
            e.preventDefault();
            run(() => (editing === "new" ? cabsApi("/api/cabs/maintenance", "POST", form) : cabsApi(`/api/cabs/maintenance/${editing.id}`, "PATCH", form)),
              editing === "new" ? "Maintenance recorded" : "Record updated", () => setEditing(null));
          }}>
            <label className="block"><span className="label-xs mb-1.5 block">Vehicle</span>
              <select className="input" name="vehicleId" value={form.vehicleId} onChange={set("vehicleId")} required autoFocus>
                <option value="">Choose a vehicle</option>
                {choices.map((v) => <option key={v.id} value={v.id}>{v.numberPlate} · {v.model}{v.isActive ? "" : " (inactive)"}</option>)}
              </select></label>
            <label className="block"><span className="label-xs mb-1.5 block">Type</span>
              <select className="input" name="type" value={form.type} onChange={set("type")} required>
                <option value="">Choose the type</option>
                {MAINTENANCE_TYPES.map((t) => <option key={t} value={t}>{MAINTENANCE_LABEL[t]}</option>)}
              </select></label>
            <label className="block"><span className="label-xs mb-1.5 block">Description</span>
              <input className="input" name="description" value={form.description} onChange={set("description")} maxLength={500} required placeholder="Oil change, brake pads…" /></label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block"><span className="label-xs mb-1.5 block">Cost in rupees (optional)</span>
                <input className="input" name="cost" inputMode="decimal" value={form.cost} onChange={set("cost")} placeholder="2,500" /></label>
              <label className="block"><span className="label-xs mb-1.5 block">Done by</span>
                <input className="input" name="doneBy" value={form.doneBy} onChange={set("doneBy")} maxLength={120} required placeholder="Service centre or mechanic" /></label>
              <label className="block"><span className="label-xs mb-1.5 block">Date done</span>
                <input className="input" name="doneAt" type="date" value={form.doneAt} max={today} onChange={set("doneAt")} required /></label>
              <label className="block"><span className="label-xs mb-1.5 block">Next due (optional)</span>
                <input className="input" name="nextDueAt" type="date" value={form.nextDueAt} min={form.doneAt} onChange={set("nextDueAt")} /></label>
            </div>
            <label className="block"><span className="label-xs mb-1.5 block">Notes (optional)</span>
              <textarea className="input min-h-16" name="notes" value={form.notes} onChange={set("notes")} maxLength={1000} /></label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>Close</button>
              <button className="btn btn-primary btn-sm" disabled={pending}>{editing === "new" ? "Add record" : "Save"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
