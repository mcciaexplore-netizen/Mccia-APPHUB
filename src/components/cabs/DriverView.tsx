"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarClock, CheckCircle2, Navigation, Play, UserRound } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { formatIST } from "@/lib/format";
import { mapsLink } from "@/lib/cabs/otp-rules";
import { cabsApi } from "./api";
import { LocationSharer } from "./LocationSharer";
import { StatusBadge, type RideView } from "./RideCard";

const navUrl = (r: RideView) => mapsLink({ text: r.pickup, lat: r.pickupLat, lng: r.pickupLng }, { text: r.dropoff, lat: r.dropoffLat, lng: r.dropoffLng });
const BIG = "flex min-h-12 w-full items-center justify-center gap-2 rounded-btn px-4 text-base font-bold";

/** Enter the rider's OTP: 4 big digits on the number keyboard, and a full-width button. */
function OtpEntry({ ride, pending, onVerify }: { ride: RideView; pending: boolean; onVerify: (otp: string) => void }) {
  const [otp, setOtp] = useState("");
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onVerify(otp); }}>
      <label className="block">
        <span className="mb-2 block text-base font-semibold text-ink">Enter OTP from rider</span>
        <input className="input !h-16 text-center font-mono !text-4xl font-bold tracking-[0.5em]" name="otp" inputMode="numeric" pattern="[0-9]{4}" maxLength={4}
          autoComplete="one-time-code" placeholder="····" aria-label={`OTP for the ride from ${ride.pickup}`} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 4))} required />
      </label>
      <button className={`btn btn-primary ${BIG}`} disabled={pending || otp.length !== 4}><CheckCircle2 size={20} /> Confirm pickup</button>
    </form>
  );
}

/** "Open Navigation": Google Maps with the route from pickup to drop-off. */
const OpenNavigation = ({ href }: { href: string }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className={`btn btn-primary ${BIG}`} data-navigation><Navigation size={20} /> Open Navigation</a>
);

/**
 * A driver's rides, built for a phone: large text and buttons. An assigned ride starts when the driver enters the rider's OTP (rides from
 * before OTPs existed keep Start Ride); then Google Maps opens with the route, and while it is under way the phone's position is shared.
 * Complete Ride at the drop-off. Past rides have no buttons.
 */
export function DriverView({ rides, empty }: { rides: RideView[]; empty: string }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [justStarted, setJustStarted] = useState<Record<string, string>>({});
  const run = (fn: () => Promise<unknown>, done: string) => start(async () => {
    try { await fn(); toast.success(done); router.refresh(); } catch (e) { toast.error((e as Error).message); }
  });
  const verify = (r: RideView, otp: string) => start(async () => {
    try {
      const { mapsUrl } = await cabsApi<{ mapsUrl: string }>(`/api/cabs/rides/${r.id}/otp/verify`, "POST", { otp });
      setJustStarted((s) => ({ ...s, [r.id]: mapsUrl }));
      toast.success("Pickup confirmed. Opening navigation…");
      window.open(mapsUrl, "_blank", "noopener"); // a phone may block this: the Open Navigation button is right there
      router.refresh();
    } catch (e) { toast.error((e as Error).message); }
  });
  const complete = async (r: RideView) => {
    if (!(await confirm({ title: "Complete this ride?", message: `${r.pickup} → ${r.dropoff}. ${r.requestedByName} will be told it is complete.`, confirmLabel: "Complete" }))) return;
    run(() => cabsApi(`/api/cabs/rides/${r.id}/complete`, "POST"), "Ride completed");
  };
  if (!rides.length) return <p className="text-base text-subtle">{empty}</p>;
  const running = rides.find((r) => r.status === "in_progress");
  return (
    <div className="space-y-4">
      {running && <LocationSharer rideId={running.id} />}
      {rides.map((r) => (
        <article key={r.id} className="glass space-y-4 p-4 sm:p-5" data-ride={r.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-lg font-bold leading-snug text-ink">{r.pickup}</p>
              <p className="text-sm text-subtle">to</p>
              <p className="text-lg font-bold leading-snug text-ink">{r.dropoff}</p>
            </div>
            <StatusBadge status={r.status} />
          </div>
          <div className="space-y-1.5 text-base text-muted">
            <p className="flex items-center gap-2"><CalendarClock size={18} aria-hidden /> {formatIST(r.scheduledFor)}</p>
            <p className="flex items-center gap-2"><UserRound size={18} aria-hidden /> {r.requestedByName}{r.vehiclePlate ? ` · ${r.vehiclePlate}` : ""}</p>
            {r.notes && <p className="text-sm text-subtle">{r.notes}</p>}
          </div>
          {r.status === "assigned" && (r.hasOtp
            ? <OtpEntry ride={r} pending={pending} onVerify={(otp) => verify(r, otp)} />
            : <button className={`btn btn-primary ${BIG}`} disabled={pending} onClick={() => run(() => cabsApi(`/api/cabs/rides/${r.id}/start`, "POST"), "Ride started")}><Play size={20} /> Start Ride</button>)}
          {r.status === "in_progress" && <>
            <OpenNavigation href={justStarted[r.id] ?? navUrl(r)} />
            <button className={`btn btn-ghost ${BIG}`} disabled={pending} onClick={() => complete(r)}><CheckCircle2 size={20} /> Complete Ride</button>
          </>}
        </article>
      ))}
    </div>
  );
}
