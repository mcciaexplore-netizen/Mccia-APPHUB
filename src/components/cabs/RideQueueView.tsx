"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarClock, Car, KeyRound, MapPin, UserCheck, UserRound, Users, X } from "lucide-react";
import { useToast } from "@/components/Toast";
import { formatIST } from "@/lib/format";
import { cabsApi } from "./api";
import { AssignDialog, type DriverOption, type VehicleOption } from "./AssignDialog";
import { CancelRideDialog } from "./CancelRideDialog";
import { whenText, type RideView } from "./RideCard";

export type OtpState = "active" | "locked" | "expired" | "none";
export type QueueRide = RideView & { otpState?: OtpState; otpExpiresAt?: string | null };

const OTP_BADGE: Record<OtpState, [string, string]> = {
  active: ["OTP active", "bg-green-tint text-brand-green-text"],
  locked: ["OTP locked (3 wrong tries)", "bg-red-tint text-brand-red"],
  expired: ["OTP expired", "bg-[#fef3c7] text-[#b45309]"],
  none: ["No OTP (starts without one)", "bg-alt text-muted"],
};

/** "waiting 25 min", "waiting 3 h". */
const waiting = (iso: string, now: number) => { const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000)); return m < 60 ? `${m} min` : m < 2880 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} days`; };

/**
 * Pending Requests ("pending": rides waiting for a driver, longest-waiting first, each with Assign and Cancel) and Upcoming Rides
 * ("upcoming": assigned rides, soonest first, with their driver, car and where the rider's OTP stands; Cancel, and New OTP once the OTP is
 * locked or expired) as cards.
 */
export function RideQueueView({ mode, rides, drivers = [], vehicles = [], now }: { mode: "pending" | "upcoming"; rides: QueueRide[]; drivers?: DriverOption[]; vehicles?: VehicleOption[]; now: number }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [assigning, setAssigning] = useState<RideView | null>(null);
  const [cancelling, setCancelling] = useState<RideView | null>(null);
  const run = (fn: () => Promise<unknown>, done: string, after: () => void) => start(async () => {
    try { await fn(); toast.success(done); after(); router.refresh(); } catch (e) { toast.error((e as Error).message); }
  });
  if (!rides.length) {
    return <p className="glass p-6 text-center text-sm text-subtle" data-queue-empty>{mode === "pending" ? "No ride is waiting for a driver." : "No ride is assigned and waiting to start."}</p>;
  }
  return (
    <>
      <div className="grid gap-3 lg:grid-cols-2">
        {rides.map((r) => {
          const otp = r.otpState ? OTP_BADGE[r.otpState] : null;
          return (
            <article key={r.id} className="glass space-y-3 p-4" data-ride={r.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-ink">{r.requestedByName}{r.requestedByBranch && <span className="font-normal text-muted"> · {r.requestedByBranch}</span>}</p>
                  {mode === "pending" && <p className="text-xs font-semibold text-[#b45309]" data-waiting>Waiting {waiting(r.createdAt, now)}</p>}
                </div>
                {otp && <span className={`shrink-0 rounded-pill px-2.5 py-0.5 text-xs font-semibold ${otp[1]}`} data-otp-state={r.otpState}>{otp[0]}</span>}
              </div>
              <p className="text-base"><b>{r.pickup}</b> → <b>{r.dropoff}</b></p>
              {r.stops.length > 0 && <p className="flex items-center gap-1.5 text-xs text-muted"><MapPin size={13} aria-hidden /> Via {r.stops.map((s) => s.text).join(", ")}</p>}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                <span className="flex items-center gap-1.5"><CalendarClock size={15} aria-hidden /> {whenText(r)}</span>
                <span className="flex items-center gap-1.5"><Users size={15} aria-hidden /> {r.passengers} {r.passengers === 1 ? "passenger" : "passengers"}</span>
                {mode === "upcoming" && <span className="flex items-center gap-1.5"><UserRound size={15} aria-hidden /> {r.driverName ?? "—"}</span>}
                {mode === "upcoming" && <span className="flex items-center gap-1.5"><Car size={15} aria-hidden /> {r.vehiclePlate ?? "—"}</span>}
              </div>
              {r.otpState === "active" && r.otpExpiresAt && <p className="text-xs text-muted">The rider&apos;s OTP works until {formatIST(r.otpExpiresAt)}.</p>}
              {r.notes && <p className="text-xs text-muted">{r.notes}</p>}
              <div className="flex flex-wrap justify-end gap-2">
                {mode === "pending" && <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => setAssigning(r)}><UserCheck size={14} /> Assign</button>}
                {(r.otpState === "locked" || r.otpState === "expired") && <button className="btn btn-ghost btn-sm" disabled={pending} title="Make a new OTP: the rider sees it on My Rides"
                  onClick={() => run(() => cabsApi(`/api/cabs/rides/${r.id}/otp/reset`, "POST"), "New OTP made. The rider sees it on My Rides.", () => {})}><KeyRound size={14} /> New OTP</button>}
                <button className="btn btn-ghost btn-sm text-brand-red" disabled={pending} onClick={() => setCancelling(r)}><X size={14} /> Cancel</button>
              </div>
            </article>
          );
        })}
      </div>
      {assigning && <AssignDialog ride={assigning} drivers={drivers} vehicles={vehicles} pending={pending}
        onAssign={(v) => run(() => cabsApi(`/api/cabs/rides/${assigning.id}/assign`, "POST", v), "Ride assigned", () => setAssigning(null))} onClose={() => setAssigning(null)} />}
      {cancelling && <CancelRideDialog ride={cancelling} pending={pending} onClose={() => setCancelling(null)}
        onCancel={(reason) => run(() => cabsApi(`/api/cabs/rides/${cancelling.id}/cancel?as=admin`, "POST", { reason }), "Ride cancelled", () => setCancelling(null))} />}
    </>
  );
}
