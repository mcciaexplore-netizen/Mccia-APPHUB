"use client";

import { useEffect, useRef, useState } from "react";
import { MapPinOff, Radio } from "lucide-react";

/** How often the latest position is sent while a ride is under way. */
export const SEND_EVERY_MS = 10_000;

type State = "asking" | "sharing" | "denied" | "unavailable";

/**
 * While the driver has a ride in progress, sends the phone's position to /api/cabs/location every 10 seconds, for the admins' fleet map.
 * It stops when the ride ends (this component goes away) or the page is closed. A web page cannot read the position while it is in the
 * background, so the driver is asked to keep it open. It sits in the driver app's frame, so it keeps sharing while the driver moves between
 * tabs.
 */
export function LocationSharer({ rideId }: { rideId: string }) {
  // A browser with no location at all is known at once; everything else is learned from the phone.
  const [state, setState] = useState<State>(() => (typeof navigator !== "undefined" && !navigator.geolocation ? "unavailable" : "asking"));
  const [sentAt, setSentAt] = useState<Date | null>(null);
  const latest = useRef<GeolocationPosition | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(
      (p) => { latest.current = p; setState("sharing"); },
      (e) => setState(e.code === e.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
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
  }, [rideId]);

  if (state === "denied" || state === "unavailable") {
    return (
      <div role="alert" className="flex items-start gap-3 rounded-xl border border-[#fcd34d] bg-[#fff8e1] p-4 text-[#b45309]">
        <MapPinOff size={22} className="mt-0.5 shrink-0" aria-hidden />
        <div><p className="text-base font-bold">Allow location so admin can track your ride</p>
          <p className="mt-1 text-sm">{state === "denied" ? "Location is blocked for this site. Allow it in your browser's site settings, then reload this page." : "Your phone's location could not be found. Check that location is turned on."}</p></div>
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
