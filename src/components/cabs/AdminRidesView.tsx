"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, KeyRound, Play, UserCheck, X } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { formatIST } from "@/lib/format";
import { cabsApi } from "./api";
import { AssignDialog, type DriverOption, type VehicleOption } from "./AssignDialog";
import { StatusBadge, whenText, type RideView } from "./RideCard";

/**
 * Every ride, as a table: assign a pending one, cancel a pending or assigned one with a reason, and make a new OTP for an assigned one
 * (after three wrong tries, or once it expired; the rider sees it, never this screen). Start and Complete run a ride for a driver who has
 * no driver app (no email, or no hub account): the admin is trusted to have checked the pickup, so no OTP is asked for. The filters are a
 * plain form (the page reads them).
 */
export function AdminRidesView({ rides, drivers, vehicles, empty }: { rides: RideView[]; drivers: DriverOption[]; vehicles: VehicleOption[]; empty: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const confirm = useConfirm();
  const [assigning, setAssigning] = useState<RideView | null>(null);
  const [cancelling, setCancelling] = useState<RideView | null>(null);
  const [reason, setReason] = useState("");
  const run = (fn: () => Promise<unknown>, done: string, after: () => void) => start(async () => {
    try { await fn(); toast.success(done); after(); router.refresh(); } catch (e) { toast.error((e as Error).message); }
  });
  // Asked before the transition starts: a dialog opened inside one never shows.
  const forDriver = async (r: RideView, step: "start" | "complete") => {
    const go = await confirm(step === "start"
      ? { title: "Start this ride for the driver?", message: `${r.pickup} → ${r.dropoff}, ${r.driverName ?? "the driver"}. Use this when the driver has no driver app and has picked up ${r.requestedByName}.`, confirmLabel: "Start ride" }
      : { title: "Complete this ride for the driver?", message: `${r.pickup} → ${r.dropoff}. ${r.requestedByName} will be told it is complete.`, confirmLabel: "Complete ride" });
    if (go) run(() => cabsApi(`/api/cabs/rides/${r.id}/${step}?as=admin`, "POST"), step === "start" ? "Ride started" : "Ride completed", () => {});
  };
  return (
    <>
      <div className="table-wrap"><table>
        <thead><tr><th>When</th><th>Route</th><th>Requested by</th><th>Driver / vehicle</th><th>Status</th><th className="text-right">Actions</th></tr></thead>
        <tbody>
          {rides.map((r) => (
            <tr key={r.id} data-ride={r.id}>
              <td className="max-w-[12rem] text-xs text-muted">{whenText(r)}</td>
              <td><b>{r.pickup}</b> → <b>{r.dropoff}</b>
                {r.stops.length > 0 && <span className="block max-w-sm text-xs text-muted">Via {r.stops.map((s) => s.text).join(", ")}</span>}
                <span className="block text-xs text-muted">{r.passengers} {r.passengers === 1 ? "passenger" : "passengers"}</span>
                {r.notes && <span className="block max-w-sm text-xs text-muted">{r.notes}</span>}</td>
              <td>{r.requestedByName}{r.requestedByBranch && <span className="block text-xs text-subtle">{r.requestedByBranch}</span>}</td>
              <td>{r.driverName ? <>{r.driverName}<span className="block text-xs text-subtle">{r.vehiclePlate}</span></> : <span className="text-subtle">—</span>}</td>
              <td><StatusBadge status={r.status} />{r.status === "cancelled" && r.cancelReason && <span className="mt-1 block max-w-xs text-xs text-muted">{r.cancelReason}</span>}</td>
              <td><div className="flex justify-end gap-1.5">
                {r.status === "pending" && <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => setAssigning(r)}><UserCheck size={14} /> Assign</button>}
                {r.status === "assigned" && <button className="btn btn-ghost btn-sm" disabled={pending} onClick={() => forDriver(r, "start")} title="For a driver without the driver app"><Play size={14} /> Start</button>}
                {r.status === "in_progress" && <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => forDriver(r, "complete")} title="For a driver without the driver app"><CheckCircle2 size={14} /> Complete</button>}
                {r.status === "assigned" && r.hasOtp && <button className="btn btn-ghost btn-sm" disabled={pending} title="Make a new OTP: the rider sees it on My Rides"
                  onClick={() => run(() => cabsApi(`/api/cabs/rides/${r.id}/otp/reset`, "POST"), "New OTP made. The rider sees it on My Rides.", () => {})}><KeyRound size={14} /> New OTP</button>}
                {(r.status === "pending" || r.status === "assigned") && <button className="btn btn-ghost btn-sm text-brand-red" disabled={pending} onClick={() => { setReason(""); setCancelling(r); }}><X size={14} /> Cancel</button>}
              </div></td>
            </tr>
          ))}
          {rides.length === 0 && <tr><td colSpan={6} className="text-subtle">{empty}</td></tr>}
        </tbody>
      </table></div>
      {assigning && <AssignDialog ride={assigning} drivers={drivers} vehicles={vehicles} pending={pending}
        onAssign={(v) => run(() => cabsApi(`/api/cabs/rides/${assigning.id}/assign`, "POST", v), "Ride assigned", () => setAssigning(null))} onClose={() => setAssigning(null)} />}
      {cancelling && (
        <Modal title="Cancel ride" onClose={() => setCancelling(null)}>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => cabsApi(`/api/cabs/rides/${cancelling.id}/cancel?as=admin`, "POST", { reason }), "Ride cancelled", () => setCancelling(null)); }}>
            <p className="text-sm text-muted"><b className="text-ink">{cancelling.pickup} → {cancelling.dropoff}</b><br />{formatIST(cancelling.scheduledFor)} · {cancelling.requestedByName}</p>
            <label className="block"><span className="label-xs mb-1.5 block">Reason (they will be told)</span>
              <textarea className="input min-h-20" name="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required autoFocus /></label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCancelling(null)}>Close</button>
              <button className="btn btn-danger btn-sm" disabled={pending || !reason.trim()}>Cancel ride</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
