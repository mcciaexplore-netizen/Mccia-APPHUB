"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowRight, ArrowUpDown, MapPin, Minus, Navigation, Plus, Users, X } from "lucide-react";
import { useToast } from "@/components/Toast";
import { AddressInput, type Place } from "./AddressInput";
import { cabsApi } from "./api";

/** A day in India time, "YYYY-MM-DD", `days` from today. */
const istDay = (days = 0) => new Date(Date.now() + days * 86_400_000 + 5.5 * 3600_000).toISOString().slice(0, 10);
/** The day after a day ("YYYY-MM-DD"). */
const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
/** Every half hour of the day, "00:00" to "23:30", shown as "9:00 AM". */
const SLOTS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
const slotLabel = (t: string) => { const [h, m] = t.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
/** A ride starts at least this long from now. */
const MIN_LEAD_MS = 15 * 60_000;
/** The moment a day and a time (India time) stand for. */
const istMoment = (day: string, time: string) => new Date(`${day}T${time}:00+05:30`).getTime();
const tooSoon = (day: string, time: string) => !day || !time || Number.isNaN(istMoment(day, time)) || istMoment(day, time) < Date.now() + MIN_LEAD_MS;
const EMPTY: Place = { text: "", lat: null, lng: null };
const MAX_STOPS = 3;
const MAX_PASSENGERS = 20;
type When = "now" | "scheduled" | "multiday";
const WHEN_TABS: { id: When; label: string }[] = [{ id: "now", label: "Now" }, { id: "scheduled", label: "Schedule" }, { id: "multiday", label: "Multi-day" }];

const card = "rounded-xl bg-white p-4 shadow-sm";

/**
 * Book a ride, laid out like the MCCIA Cabs app: where from and to (with up to 3 stops, a swap, suggestions and "Use my location"),
 * when (now, at a time, or over several days), and how many people. Sent as pending; a Cabs admin approves it and assigns a car and a driver.
 */
export function BookingForm() {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [pickup, setPickup] = useState<Place>(EMPTY);
  const [dropoff, setDropoff] = useState<Place>(EMPTY);
  const [stops, setStops] = useState<Place[]>([]);
  const [when, setWhen] = useState<When>("now");
  // Schedule and Multi-day start tomorrow at 9:00 AM; Multi-day runs until the day after.
  const [day, setDay] = useState(() => istDay(1));
  const [time, setTime] = useState("09:00");
  const [until, setUntil] = useState(() => istDay(2));
  const [timeError, setTimeError] = useState("");
  const [passengers, setPassengers] = useState(1);
  const [noteOpen, setNoteOpen] = useState(false);
  const [notes, setNotes] = useState("");

  const swap = () => { setPickup(dropoff); setDropoff(pickup); };
  const setStop = (i: number, p: Place) => setStops(stops.map((s, j) => (j === i ? p : s)));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (when !== "now" && tooSoon(day, time)) { setTimeError("Please select a future time"); return; }
    if (when === "multiday" && !(until > day)) { setTimeError("The last day must be after the first day."); return; }
    setTimeError("");
    start(async () => {
      try {
        await cabsApi("/api/cabs/rides", "POST", {
          pickup: pickup.text, dropoff: dropoff.text, pickupLat: pickup.lat, pickupLng: pickup.lng, dropoffLat: dropoff.lat, dropoffLng: dropoff.lng,
          tripType: when, scheduledFor: when === "now" ? undefined : `${day}T${time}`, endsOn: when === "multiday" ? until : undefined,
          stops: stops.filter((s) => s.text.trim()), passengers, notes: noteOpen ? notes : "",
        });
        toast.success("Request sent. You'll be told once it is approved.");
        router.push("/cabs/rides");
        router.refresh();
      } catch (err) { toast.error((err as Error).message); }
    });
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <section className={`${card} !py-2`} aria-label="Where">
        <div className="flex items-center gap-3">
          <MapPin size={20} className="shrink-0 text-[#2a6b7c]" aria-hidden />
          {/* Room on the right for the swap button below, so "Use my location" sits beside it, not on it. */}
          <div className="min-w-0 flex-1 pr-12"><AddressInput bare name="pickup" label="Pickup location" placeholder="Pickup location or select an office →" value={pickup} onChange={setPickup} locate autoFocus /></div>
        </div>
        {stops.map((s, i) => (
          <div key={i} className="flex items-center gap-3 border-t border-black/5">
            <span className="flex w-5 shrink-0 justify-center" aria-hidden><span className="h-2.5 w-2.5 rounded-full border-2 border-[#2a6b7c]" /></span>
            <div className="min-w-0 flex-1"><AddressInput bare name={`stop-${i}`} label={`Stop ${i + 1}`} placeholder={`Stop ${i + 1}`} value={s} onChange={(p) => setStop(i, p)} /></div>
            <button type="button" className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-[#f5f5f5]" onClick={() => setStops(stops.filter((_, j) => j !== i))} aria-label={`Remove stop ${i + 1}`}><X size={16} /></button>
          </div>
        ))}
        <div className="relative border-t border-black/5">
          <button type="button" onClick={swap} aria-label="Swap pickup and drop-off"
            className="absolute -top-5 right-2 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-white text-[#2a6b7c] shadow-sm hover:bg-[#e8f3f5]"><ArrowUpDown size={16} /></button>
          <div className="flex items-center gap-3">
            <Navigation size={18} className="shrink-0 rotate-90 text-[#1a2b4a]" aria-hidden />
            <div className="min-w-0 flex-1 pr-12"><AddressInput bare name="dropoff" label="Drop-off" placeholder="Where to?" value={dropoff} onChange={setDropoff} /></div>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 border-t border-black/5 pt-2">
          {stops.length < MAX_STOPS && <button type="button" className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-[#2a6b7c]" onClick={() => setStops([...stops, EMPTY])}><Plus size={15} /> Add a stop</button>}
          {!noteOpen && <button type="button" className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-[#2a6b7c]" onClick={() => setNoteOpen(true)}><Plus size={15} /> Add a note</button>}
        </div>
        {noteOpen && <textarea className="input mb-2 min-h-16" name="notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="Luggage, a return trip, where to wait…" aria-label="Note" autoFocus />}
      </section>

      <section className={`${card} space-y-3`} aria-labelledby="when-heading">
        <h2 id="when-heading" className="text-base font-bold text-ink">When</h2>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-[#f5f5f5] p-1" role="tablist" aria-label="When">
          {WHEN_TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={when === t.id} onClick={() => { setWhen(t.id); setTimeError(""); }}
              className={`min-h-11 rounded-md text-sm font-semibold transition-colors ${when === t.id ? "bg-white text-[#1a2b4a] shadow-sm" : "text-muted hover:text-ink"}`}>{t.label}</button>
          ))}
        </div>
        {when === "now" && <p className="text-sm text-muted">Leave as soon as your request is approved.</p>}
        {when !== "now" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="label-xs mb-1.5 block">{when === "multiday" ? "First day" : "Date"}</span>
              <input className="input min-h-12 text-base" type="date" name="scheduledDate" value={day} min={istDay(0)} required
                onChange={(e) => { const d = e.target.value; setDay(d); setTimeError(""); if (d && until <= d) setUntil(nextDay(d)); }} /></label>
            <label className="block"><span className="label-xs mb-1.5 block">{when === "multiday" ? "Start time (IST)" : "Time (IST)"}</span>
              <select className="input min-h-12 text-base" name="scheduledTime" value={time} onChange={(e) => { setTime(e.target.value); setTimeError(""); }} required>
                {SLOTS.map((t) => <option key={t} value={t} disabled={day === istDay(0) && tooSoon(day, t)}>{slotLabel(t)}</option>)}
              </select></label>
            {when === "multiday" && (
              <label className="block sm:col-span-2"><span className="label-xs mb-1.5 block">Last day</span>
                <input className="input min-h-12 text-base" type="date" name="endsOn" value={until} min={day ? nextDay(day) : istDay(1)} required
                  onChange={(e) => { setUntil(e.target.value); setTimeError(""); }} /></label>
            )}
          </div>
        )}
        {timeError && <p className="text-sm font-semibold text-brand-red" role="alert" data-time-error>{timeError}</p>}
      </section>

      <section className={`${card} flex items-center gap-3`} aria-label="Passengers">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f5f5f5] text-[#1a2b4a]"><Users size={18} aria-hidden /></span>
        <p className="flex-1"><span className="block font-bold text-ink">Passengers</span><span className="text-sm text-muted">Including you</span></p>
        <div className="flex items-center gap-1">
          <button type="button" className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-black/10 text-ink disabled:opacity-40" onClick={() => setPassengers(passengers - 1)} disabled={passengers <= 1} aria-label="Fewer passengers"><Minus size={18} /></button>
          <span className="w-8 text-center text-lg font-bold text-ink" data-passengers aria-live="polite">{passengers}</span>
          <button type="button" className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-black/10 text-ink disabled:opacity-40" onClick={() => setPassengers(passengers + 1)} disabled={passengers >= MAX_PASSENGERS} aria-label="More passengers"><Plus size={18} /></button>
        </div>
      </section>

      <button className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-[#1a2b4a] text-base font-bold text-white shadow-sm transition-opacity hover:opacity-95 disabled:opacity-60" disabled={pending}>
        {pending ? "Sending…" : <>Send request <ArrowRight size={18} aria-hidden /></>}
      </button>
      <p className="text-center text-sm text-muted">An MCCIA admin approves your request and assigns the car and driver.</p>
    </form>
  );
}
