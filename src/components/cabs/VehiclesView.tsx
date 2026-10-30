"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pencil, Plus, Power } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { cabsApi } from "./api";

export type VehicleView = {
  id: string; numberPlate: string; model: string; capacity: number; isActive: boolean; drivers: string | null; activeRides: number;
  /** From the vehicle's latest maintenance record. */
  lastMaintenanceAt: string | null; nextDueAt: string | null;
};
/** The day in India ("YYYY-MM-DD") of an ISO time. */
const istDay = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3600_000).toISOString().slice(0, 10);
const shortDay = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
type Form = { numberPlate: string; model: string; capacity: string };

/**
 * The fleet: add a vehicle, edit one, deactivate it (or make it active again). Vehicles are never deleted. Its last maintenance and next
 * due date show beside it; the due date in red when it has passed or is within 7 days.
 */
export function VehiclesView({ vehicles, today }: { vehicles: VehicleView[]; today: string }) {
  const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<VehicleView | "new" | null>(null);
  const [form, setForm] = useState<Form>({ numberPlate: "", model: "", capacity: "4" });
  const run = (fn: () => Promise<unknown>, done: string, after?: () => void) => start(async () => {
    try { await fn(); toast.success(done); after?.(); router.refresh(); } catch (e) { toast.error((e as Error).message); }
  });
  const open = (v: VehicleView | "new") => { setForm(v === "new" ? { numberPlate: "", model: "", capacity: "4" } : { numberPlate: v.numberPlate, model: v.model, capacity: String(v.capacity) }); setEditing(v); };
  const deactivate = async (v: VehicleView) => {
    if (!(await confirm({ title: `Deactivate ${v.numberPlate}?`, message: "It can no longer be given rides. Past rides keep naming it, and you can make it active again.", confirmLabel: "Deactivate", danger: true }))) return;
    run(() => cabsApi(`/api/cabs/vehicles/${v.id}`, "DELETE"), "Vehicle deactivated");
  };
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button className="btn btn-primary btn-sm" onClick={() => open("new")}><Plus size={14} /> Add vehicle</button></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Number plate</th><th>Model</th><th className="text-right">Seats</th><th>Drivers</th><th>Last maintenance</th><th>Next due</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
        <tbody>
          {vehicles.map((v) => (
            <tr key={v.id} data-vehicle={v.id}>
              <td><b>{v.numberPlate}</b></td>
              <td>{v.model}</td>
              <td className="text-right">{v.capacity}</td>
              <td>{v.drivers ?? <span className="text-subtle">—</span>}</td>
              <td className="whitespace-nowrap text-xs text-muted">{v.lastMaintenanceAt ? shortDay(v.lastMaintenanceAt) : "—"}</td>
              <td className={`whitespace-nowrap text-xs ${v.nextDueAt && istDay(v.nextDueAt) <= soon ? "font-bold text-brand-red" : "text-muted"}`} data-due-soon={(v.nextDueAt && istDay(v.nextDueAt) <= soon) || undefined}>
                {v.nextDueAt ? `${shortDay(v.nextDueAt)}${istDay(v.nextDueAt) < today ? " · overdue" : ""}` : "—"}</td>
              <td>{v.isActive ? <span className="badge badge-green">Active</span> : <span className="badge badge-neutral">Inactive</span>}{v.activeRides > 0 && <span className="block text-xs text-muted">{v.activeRides} ride{v.activeRides === 1 ? "" : "s"} on</span>}</td>
              <td><div className="flex justify-end gap-1.5">
                <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => open(v)}><Pencil size={14} /> Edit</button>
                {v.isActive ? <button className="btn btn-ghost btn-sm text-brand-red" disabled={pending} onClick={() => deactivate(v)}><Power size={14} /> Deactivate</button>
                  : <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => run(() => cabsApi(`/api/cabs/vehicles/${v.id}`, "PATCH", { isActive: true }), "Vehicle active again")}><Power size={14} /> Activate</button>}
              </div></td>
            </tr>
          ))}
          {vehicles.length === 0 && <tr><td colSpan={8} className="text-subtle">No vehicles yet.</td></tr>}
        </tbody>
      </table></div>
      {editing && (
        <Modal title={editing === "new" ? "Add vehicle" : `Edit ${editing.numberPlate}`} onClose={() => setEditing(null)}>
          <form className="space-y-4" onSubmit={(e) => {
            e.preventDefault();
            const body = { ...form, capacity: Number(form.capacity) };
            run(() => (editing === "new" ? cabsApi("/api/cabs/vehicles", "POST", body) : cabsApi(`/api/cabs/vehicles/${editing.id}`, "PATCH", body)), editing === "new" ? "Vehicle added" : "Vehicle updated", () => setEditing(null));
          }}>
            <label className="block"><span className="label-xs mb-1.5 block">Number plate</span>
              <input className="input" name="numberPlate" value={form.numberPlate} onChange={(e) => setForm({ ...form, numberPlate: e.target.value })} maxLength={20} required autoFocus placeholder="MH 12 AB 1234" /></label>
            <label className="block"><span className="label-xs mb-1.5 block">Model</span>
              <input className="input" name="model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} maxLength={80} required placeholder="Toyota Innova" /></label>
            <label className="block"><span className="label-xs mb-1.5 block">Seats</span>
              <input className="input" name="capacity" type="number" min={1} max={50} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} required /></label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>Close</button>
              <button className="btn btn-primary btn-sm" disabled={pending}>{editing === "new" ? "Add vehicle" : "Save"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
