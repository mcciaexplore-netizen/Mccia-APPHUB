"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { IndianRupee, Pencil } from "lucide-react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { formatIST } from "@/lib/format";
import { formatRupees, paiseToRupees } from "@/lib/cabs/money";
import { cabsApi } from "./api";

export type CostedRideView = {
  rideId: string; completedAt: string | null; requestedByName: string; branch: string | null; pickup: string; dropoff: string; driverName: string | null;
  farePaise: number | null; distanceKm: number | null; costNotes: string | null; recordedByName: string | null; invoiceNumber: string | null; invoiceStatus: string | null;
};

/** Completed rides and their costs: "Add cost" on a ride that has none, "Edit" until its invoice is sent. */
export function PaymentsView({ rides }: { rides: CostedRideView[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<CostedRideView | null>(null);
  const [form, setForm] = useState({ fare: "", distanceKm: "", notes: "" });
  const open = (r: CostedRideView) => { setForm({ fare: paiseToRupees(r.farePaise), distanceKm: r.distanceKm == null ? "" : String(r.distanceKm), notes: r.costNotes ?? "" }); setEditing(r); };
  const save = () => start(async () => {
    if (!editing) return;
    try {
      const { result } = await cabsApi<{ result: string }>(`/api/cabs/rides/${editing.rideId}/cost`, "POST", form);
      toast.success(result === "changed" ? "Cost changed" : "Cost recorded"); setEditing(null); router.refresh();
    } catch (e) { toast.error((e as Error).message); }
  });
  return (
    <>
      <div className="table-wrap"><table>
        <thead><tr><th>Completed</th><th>Rider</th><th>Route</th><th className="text-right">Cost</th><th>Recorded by</th><th>Invoice</th><th className="text-right">Actions</th></tr></thead>
        <tbody>
          {rides.map((r) => {
            const locked = r.invoiceStatus === "sent" || r.invoiceStatus === "paid";
            return (
              <tr key={r.rideId} data-cost-ride={r.rideId}>
                <td className="whitespace-nowrap text-xs text-muted">{r.completedAt ? formatIST(r.completedAt) : "—"}</td>
                <td>{r.requestedByName}{r.branch && <span className="block text-xs text-subtle">{r.branch}</span>}</td>
                <td>{r.pickup} → {r.dropoff}{r.driverName && <span className="block text-xs text-subtle">{r.driverName}</span>}</td>
                <td className="text-right font-semibold">{formatRupees(r.farePaise)}{r.distanceKm != null && <span className="block text-xs font-normal text-subtle">{r.distanceKm} km</span>}</td>
                <td>{r.recordedByName ?? <span className="text-subtle">—</span>}</td>
                <td>{r.invoiceNumber ? <>{r.invoiceNumber}<span className="block text-xs text-subtle">{r.invoiceStatus}</span></> : <span className="text-subtle">—</span>}</td>
                <td><div className="flex justify-end">
                  {r.farePaise == null ? <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => open(r)}><IndianRupee size={14} /> Add Cost</button>
                    : !locked && <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => open(r)}><Pencil size={14} /> Edit</button>}
                </div></td>
              </tr>
            );
          })}
          {rides.length === 0 && <tr><td colSpan={7} className="text-subtle">No completed rides match.</td></tr>}
        </tbody>
      </table></div>
      {editing && (
        <Modal title={editing.farePaise == null ? "Add ride cost" : "Change ride cost"} onClose={() => setEditing(null)}>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <p className="text-sm text-muted"><b className="text-ink">{editing.pickup} → {editing.dropoff}</b><br />{editing.requestedByName}{editing.completedAt ? ` · ${formatIST(editing.completedAt)}` : ""}</p>
            <label className="block"><span className="label-xs mb-1.5 block">Cost in rupees</span>
              <input className="input" name="fare" inputMode="decimal" value={form.fare} onChange={(e) => setForm({ ...form, fare: e.target.value })} required autoFocus placeholder="850" /></label>
            <label className="block"><span className="label-xs mb-1.5 block">Distance in km (optional)</span>
              <input className="input" name="distanceKm" inputMode="decimal" value={form.distanceKm} onChange={(e) => setForm({ ...form, distanceKm: e.target.value })} placeholder="18.5" /></label>
            <label className="block"><span className="label-xs mb-1.5 block">Notes (optional)</span>
              <textarea className="input min-h-16" name="notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={500} placeholder="Tolls, waiting time…" /></label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>Close</button>
              <button className="btn btn-primary btn-sm" disabled={pending}>Save</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
