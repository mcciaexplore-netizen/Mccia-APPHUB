"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MapPinOff, Radio, RotateCw } from "lucide-react";
import { gpsErrorMessage } from "./geo";

/** How often the latest position is sent while a ride is under way. */
export const SEND_EVERY_MS = 10_000;

type State = "asking" | "sharing" | "denied" | "unavailable" | "timeout";

const noSubscribe = () => () => {};

/**
 * While the driver has a ride in progress, sends the phone's position to /api/cabs/location every 10 seconds, for the admins' fleet map.
 * It stops when the ride ends (this component goes away) or the page is closed. A web page cannot read the position while it is in the
 * background, so the driver is asked to keep it open. It sits in the driver app's frame, so it keeps sharing while the driver moves between
 * tabs.
 */
export function LocationSharer({ rideId }: { rideId: string }) {
  // A browser with no location at all is known at once; everything else is learned from the phone. Read through useSyncExternalStore so the
  // server's HTML (which assumes there is one: Node has a `navigator` too, without geolocation) and the first render in the browser agree.
  const hasGps = useSyncExternalStore(noSubscribe, () => !!navigator.geolocation, () => true);
  const [watched, setState] = useState<State>("asking");
  const state: State = hasGps ? watched : "unavailable";
  const [sentAt, setSentAt] = useState<Date | null>(null);
  const latest = useRef<GeolocationPosition | null>(null);
  // Bumped by "Try again": starts a fresh watch (and a fresh permission prompt where the browser allows one).
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(
      (p) => { latest.current = p; setState("sharing"); },
      // A timeout or a lost signal does not end the watch: the next position that arrives turns sharing back on.
      (e) => setState(e.code === e.PERMISSION_DENIED ? "denied" : e.code === e.TIMEOUT ? "timeout" : "unavailable"),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 5_000 },
    );
    const send = async () => {
      const p = latest.current;
      if (!p) return;
      const c = p.coords;
      try {
        const res = await fetch("/api/cabs/location", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            latitude: c.latitude, longitude: c.longitude, accuracy: c.accuracy ?? null,
            heading: c.heading != null && !Number.isNaN(c.heading) ? c.heading : null,
            speed: c.speed != null && !Number.isNaN(c.speed) ? Math.round(c.speed * 3.6 * 10) / 10 : null, // m/s → km/h
            rideId,
          }),
        });
        if (res.ok) setSentAt(new Date());
      } catch { /* offline for a moment: the next one goes in 10 seconds */ }
    };
    const first = setTimeout(send, 1_500); // as soon as there is a first fix, then every 10 seconds
    const timer = setInterval(send, SEND_EVERY_MS);
    return () => { navigator.geolocation.clearWatch(watch); clearTimeout(first); clearInterval(timer); };
  }, [rideId, attempt]);

  if (state === "denied" || state === "unavailable" || state === "timeout") {
    const code = state === "denied" ? 1 : state === "timeout" ? 3 : 2;
    return (
      <div role="alert" className="flex items-start gap-3 rounded-xl border border-[#fcd34d] bg-[#fff8e1] p-4 text-[#b45309]" data-gps-error={state}>
        <MapPinOff size={22} className="mt-0.5 shrink-0" aria-hidden />
        <div className="flex-1">
          <p className="text-base font-bold">{state === "denied" ? "Allow location so admin can track your ride" : "Location not shared"}</p>
          <p className="mt-1 text-sm">{gpsErrorMessage(code)}</p>
          <button type="button" onClick={() => { setState("asking"); setAttempt((n) => n + 1); }} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#1a2b4a] px-4 text-sm font-semibold text-white">
            <RotateCw size={15} aria-hidden /> Try again</button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3 rounded-xl bg-white p-4 shadow-sm" data-sharing={state}>
      <Radio size={22} className={`mt-0.5 shrink-0 text-primary ${state === "sharing" ? "animate-pulse" : ""}`} aria-hidden />
      <div>
        <p className="text-base font-bold text-ink">{state === "sharing" ? "Sharing location" : "Allow location so admin can track your ride"}</p>
        <p className="mt-1 text-sm text-muted">Keep this page open to share your location{sentAt ? ` · last sent ${sentAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : ""}.</p>
      </div>
    </div>
  );
}
