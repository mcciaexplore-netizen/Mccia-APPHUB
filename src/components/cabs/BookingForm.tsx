"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useToast } from "@/components/Toast";
import { cabsApi } from "./api";

/** Now in India time, as a datetime-local input wants it ("2026-11-02T09:30"): the earliest time that can be picked. */
const istNow = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 16);

/** Book a ride: where from and to, when (India time), and an optional note. Sent as pending; a Cabs admin assigns a driver and a car. */
export function BookingForm({ branchName }: { branchName: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [v, setV] = useState({ pickup: "", dropoff: "", scheduledFor: "", notes: "" });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      try {
        await cabsApi("/api/cabs/rides", "POST", v);
        toast.success("Ride requested. You'll be told once it is confirmed.");
        router.push("/cabs/rides");
        router.refresh();
      } catch (err) { toast.error((err as Error).message); }
    });
  };
  return (
    <form className="glass max-w-xl space-y-4 p-5" onSubmit={submit}>
      <label className="block"><span className="label-xs mb-1.5 block">Pickup</span>
        <input className="input" name="pickup" value={v.pickup} onChange={set("pickup")} maxLength={200} required autoFocus placeholder="e.g. MCCIA Tilak Road office" /></label>
      <label className="block"><span className="label-xs mb-1.5 block">Drop-off</span>
        <input className="input" name="dropoff" value={v.dropoff} onChange={set("dropoff")} maxLength={200} required placeholder="e.g. Pune Airport" /></label>
      <label className="block"><span className="label-xs mb-1.5 block">Date and time (India time)</span>
        <input className="input" type="datetime-local" name="scheduledFor" value={v.scheduledFor} min={istNow()} onChange={set("scheduledFor")} required /></label>
      <label className="block"><span className="label-xs mb-1.5 block">Notes (optional)</span>
        <textarea className="input min-h-20" name="notes" value={v.notes} onChange={set("notes")} maxLength={500} placeholder="Number of people, luggage, a return trip…" /></label>
      {branchName && <p className="text-xs text-muted">Booked for your branch: {branchName}.</p>}
      <button className="btn btn-primary" disabled={pending}>{pending ? "Sending…" : "Request ride"}</button>
    </form>
  );
}
