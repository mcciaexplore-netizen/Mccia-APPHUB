"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarClock, CheckCircle2, ChevronRight, Inbox, MapPin, Navigation, Play, UserRound, Users } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { formatIST } from "@/lib/format";
import { mapsLink } from "@/lib/cabs/otp-rules";
import { cabsApi } from "./api";
import { StatusBadge, whenText, type RideView } from "./RideCard";

const navUrl = (r: RideView) => mapsLink({ text: r.pickup, lat: r.pickupLat, lng: r.pickupLng }, { text: r.dropoff, lat: r.dropoffLat, lng: r.dropoffLng }, r.stops);
const BIG = "flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-base font-bold";
const NAVY = `${BIG} bg-[#1a2b4a] text-white disabled:opacity-50`;
const TEAL = `${BIG} bg-[#2a6b7c] text-white`;
const card = "space-y-4 rounded-xl bg-white p-4 shadow-sm";

/** Pickup → drop-off, large, with any stops between. */
function Route({ ride, big = false }: { ride: RideView; big?: boolean }) {
  const text = big ? "text-xl" : "text-lg";
  return (
    <div className="space-y-1">
      <p className={`${text} font-bold leading-snug text-ink`}>{ride.pickup}</p>
      {ride.stops.map((s, i) => <p key={i} className="flex items-center gap-1.5 text-sm text-muted"><MapPin size={14} aria-hidden /> {s.text}</p>)}
      <p className="text-sm text-subtle">to</p>
      <p className={`${text} font-bold leading-snug text-ink`}>{ride.dropoff}</p>
    </div>
  );
}

function Facts({ ride }: { ride: RideView }) {
  return (
    <div className="space-y-1.5 text-base text-muted">
      <p className="flex items-center gap-2"><UserRound size={18} aria-hidden /> {ride.requestedByName}{ride.vehiclePlate ? ` · ${ride.vehiclePlate}` : ""}</p>
      <p className="flex items-center gap-2"><CalendarClock size={18} aria-hidden /> {whenText(ride)}</p>
      <p className="flex items-center gap-2"><Users size={18} aria-hidden /> {ride.passengers} {ride.passengers === 1 ? "passenger" : "passengers"}</p>
      {ride.notes && <p className="text-sm text-subtle">{ride.notes}</p>}
    </div>
  );
}

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
      <button className={NAVY} disabled={pending || otp.length !== 4}><CheckCircle2 size={20} /> Confirm pickup</button>
    </form>
  );
}

/** "Open Google Maps": the route from pickup to drop-off (through any stops), by coordinates when the ride has them, else by the addresses. */
const OpenNavigation = ({ href }: { href: string }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className={TEAL} data-navigation><Navigation size={20} /> Open Google Maps</a>
);

/**
 * Assigned: the rides given to this driver and not yet picked up. A ride starts when the driver enters the rider's OTP (rides from before
 * OTPs keep Start Ride). A right OTP turns the card into "Pickup confirmed" with a full-width Open Google Maps button: a link the driver
 * taps, because a phone blocks a page opening Maps by itself after waiting for the server. The Trip tab has the same button.
 */
/** What an admin sees in place of the buttons when previewing another driver's app. */
const PreviewNote = () => <p className="rounded-lg bg-[#f0f2f5] px-3 py-2.5 text-sm text-muted" data-preview-note>Preview only: start and complete this ride on All Rides.</p>;

export function AssignedList({ rides, preview = false }: { rides: RideView[]; preview?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  // The ride just picked up, kept here after the refresh takes it off this list (it is in progress now).
  const [picked, setPicked] = useState<{ ride: RideView; mapsUrl: string } | null>(null);
  const verify = (r: RideView, otp: string) => start(async () => {
    try {
      const { mapsUrl } = await cabsApi<{ mapsUrl: string }>(`/api/cabs/rides/${r.id}/otp/verify`, "POST", { otp });
      toast.success("Pickup confirmed");
      setPicked({ ride: { ...r, status: "in_progress" }, mapsUrl });
      router.refresh(); // starts sharing the phone's position (the driver app's frame does it while a ride is under way)
    } catch (e) { toast.error((e as Error).message); }
  });
  const startPlain = (r: RideView) => start(async () => {
    try { await cabsApi(`/api/cabs/rides/${r.id}/start`, "POST"); toast.success("Ride started"); router.push("/cabs/driver/trip"); router.refresh(); }
    catch (e) { toast.error((e as Error).message); }
  });
  const pickedCard = picked && (
    <article className={card} data-ride={picked.ride.id} data-picked-up>
      <div className="flex items-start justify-between gap-3"><Route ride={picked.ride} /><StatusBadge status="in_progress" /></div>
      <p className="flex items-center gap-2 text-base font-bold text-[#15803d]"><CheckCircle2 size={20} aria-hidden /> Pickup confirmed. The ride is under way.</p>
      <OpenNavigation href={picked.mapsUrl} />
      <button type="button" className={NAVY} onClick={() => { router.push("/cabs/driver/trip"); router.refresh(); }}>Go to Trip <ChevronRight size={20} aria-hidden /></button>
    </article>
  );
  const others = rides.filter((r) => r.id !== picked?.ride.id);
  if (!others.length && pickedCard) return pickedCard;
  if (!rides.length) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl bg-white px-6 py-10 text-center shadow-sm" data-empty-assigned>
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#f0f2f5] text-muted"><Inbox size={26} aria-hidden /></span>
        <p className="max-w-xs text-base text-muted">No passengers assigned right now. You will get a notification when the office assigns one.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {pickedCard}
      {others.map((r) => (
        <article key={r.id} className={card} data-ride={r.id}>
          <div className="flex items-start justify-between gap-3"><Route ride={r} /><StatusBadge status={r.status} /></div>
          <Facts ride={r} />
          {r.status === "assigned" && preview && <PreviewNote />}
          {r.status === "assigned" && !preview && (r.hasOtp
            ? <OtpEntry ride={r} pending={pending} onVerify={(otp) => verify(r, otp)} />
            : <button className={NAVY} disabled={pending} onClick={() => startPlain(r)}><Play size={20} /> Start Ride</button>)}
        </article>
      ))}
    </div>
  );
}

/** Trip: the ride under way, large, with Open Navigation and Complete Ride. */
export function TripView({ ride, preview = false }: { ride: RideView | null; preview?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  if (!ride) return <p className="rounded-xl bg-white px-6 py-10 text-center text-base text-muted shadow-sm" data-no-trip>No trip in progress. Start one from Assigned with the rider&apos;s OTP.</p>;
  const complete = async () => {
    if (!(await confirm({ title: "Complete this ride?", message: `${ride.pickup} → ${ride.dropoff}. ${ride.requestedByName} will be told it is complete.`, confirmLabel: "Complete" }))) return;
    start(async () => {
      try { await cabsApi(`/api/cabs/rides/${ride.id}/complete`, "POST"); toast.success("Ride completed"); router.push("/cabs/driver/rides"); router.refresh(); }
      catch (e) { toast.error((e as Error).message); }
    });
  };
  return (
    <article className={card} data-ride={ride.id}>
      <div className="flex items-start justify-between gap-3"><Route ride={ride} big /><StatusBadge status={ride.status} /></div>
      <Facts ride={ride} />
      <OpenNavigation href={navUrl(ride)} />
      {preview ? <PreviewNote /> : <button className={NAVY} disabled={pending} onClick={complete}><CheckCircle2 size={20} /> Complete Ride</button>}
    </article>
  );
}

/** How long a finished ride took: "25 min", "1 h 10 min". */
const took = (r: { startedAt: string | null; completedAt: string | null }) => {
  if (!r.startedAt || !r.completedAt) return "—";
  const m = Math.max(0, Math.round((Date.parse(r.completedAt) - Date.parse(r.startedAt)) / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

/** History: completed rides, newest first, with the date, the route and how long each took. */
export function HistoryList({ rides }: { rides: (RideView & { startedAt: string | null; completedAt: string | null })[] }) {
  if (!rides.length) return <p className="rounded-xl bg-white px-6 py-10 text-center text-base text-muted shadow-sm">No completed rides yet.</p>;
  return (
    <ul className="divide-y divide-black/5 overflow-hidden rounded-xl bg-white shadow-sm">
      {rides.map((r) => (
        <li key={r.id} className="space-y-1 p-4" data-ride={r.id}>
          <p className="flex items-center justify-between gap-3 text-sm text-muted"><span>{r.completedAt ? formatIST(r.completedAt) : "—"}</span><span className="font-semibold text-ink">{took(r)}</span></p>
          <p className="font-semibold text-ink">{r.pickup} → {r.dropoff}</p>
          <p className="text-sm text-muted">{r.requestedByName}{r.vehiclePlate ? ` · ${r.vehiclePlate}` : ""}</p>
        </li>
      ))}
    </ul>
  );
}
