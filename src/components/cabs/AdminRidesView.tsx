"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { KeyRound, UserCheck, X } from "lucide-react";
import { useToast } from "@/components/Toast";
import { cabsApi } from "./api";
import { AssignDialog, type DriverOption, type VehicleOption } from "./AssignDialog";
import { CancelRideDialog } from "./CancelRideDialog";
import { StatusBadge, whenText, type RideView } from "./RideCard";

/**
 * Every ride, as a table: assign a pending one, cancel a pending or assigned one with a reason, and make a new OTP for an assigned one
 * (after three wrong tries, or once it expired; the rider sees it, never this screen). Only the driver starts a ride (by entering the
 * rider's OTP) and completes it, in the driver app. The filters are a plain form (the page reads them).
 */
export function AdminRidesView({ rides, drivers, vehicles, empty }: { rides: RideView[]; drivers: DriverOption[]; vehicles: VehicleOption[]; empty: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [assigning, setAssigning] = useState<RideView | null>(null);
  const [cancelling, setCancelling] = useState<RideView | null>(null);
  const run = (fn: () => Promise<unknown>, done: string, after: () => void) => start(async () => {
    try { await fn(); toast.success(done); after(); router.refresh(); } catch (e) { toast.error((e as Error).message); }
  });
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
                {r.status === "assigned" && r.hasOtp && <button className="btn btn-ghost btn-sm" disabled={pending} title="Make a new OTP: the rider sees it on My Rides"
                  onClick={() => run(() => cabsApi(`/api/cabs/rides/${r.id}/otp/reset`, "POST"), "New OTP made. The rider sees it on My Rides.", () => {})}><KeyRound size={14} /> New OTP</button>}
                {(r.status === "pending" || r.status === "assigned") && <button className="btn btn-ghost btn-sm text-brand-red" disabled={pending} onClick={() => setCancelling(r)}><X size={14} /> Cancel</button>}
              </div></td>
            </tr>
          ))}
          {rides.length === 0 && <tr><td colSpan={6} className="text-subtle">{empty}</td></tr>}
        </tbody>
      </table></div>
      {assigning && <AssignDialog ride={assigning} drivers={drivers} vehicles={vehicles} pending={pending}
        onAssign={(v) => run(() => cabsApi(`/api/cabs/rides/${assigning.id}/assign`, "POST", v), "Ride assigned", () => setAssigning(null))} onClose={() => setAssigning(null)} />}
      {cancelling && <CancelRideDialog ride={cancelling} pending={pending} onClose={() => setCancelling(null)}
        onCancel={(reason) => run(() => cabsApi(`/api/cabs/rides/${cancelling.id}/cancel?as=admin`, "POST", { reason }), "Ride cancelled", () => setCancelling(null))} />}
    </>
  );
}
