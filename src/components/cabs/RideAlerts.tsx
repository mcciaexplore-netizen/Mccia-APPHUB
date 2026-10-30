"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Bell, X } from "lucide-react";

/**
 * Alerts for riders, while a Cabs page is open (the hub has no push notifications, so nothing arrives with every page closed). With the
 * browser's permission, the page checks the person's rides every 30 seconds and shows a notification when one is confirmed, cancelled or
 * completed. The bell and the email still come as before.
 */

const DISMISSED = "cabs-alerts-dismissed";
const EVERY_MS = 30_000;
type Mine = { id: string; status: string; pickup: string; dropoff: string; driverName: string | null; vehiclePlate: string | null };

/** The browser's notification permission ("unsupported" where there is none), read so the server and the first render agree. */
function usePermission(): NotificationPermission | "unsupported" {
  return useSyncExternalStore(
    (cb) => { const t = setInterval(cb, 2_000); return () => clearInterval(t); },
    () => (typeof Notification === "undefined" ? "unsupported" : Notification.permission),
    () => "unsupported",
  );
}

/** "Get alerts when your request is approved?" with Enable and a dismiss: on the Book page until the person answers it. */
export function RideAlertsBanner() {
  const permission = usePermission();
  const dismissedNow = useSyncExternalStore(() => () => {}, () => { try { return localStorage.getItem(DISMISSED) === "1"; } catch { return false; } }, () => true);
  const [closed, setClosed] = useState(false);
  if (permission !== "default" || dismissedNow || closed) return null;
  const dismiss = () => { try { localStorage.setItem(DISMISSED, "1"); } catch { /* private window */ } setClosed(true); };
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white p-4 shadow-sm" role="region" aria-label="Ride alerts" data-alerts-banner>
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e8f3f5] text-[#2a6b7c]"><Bell size={18} aria-hidden /></span>
      <p className="flex-1 text-sm text-ink">Get alerts when your request is approved?<span className="block text-xs text-muted">While a Cabs page is open in your browser.</span></p>
      <button type="button" className="min-h-10 rounded-lg bg-[#1a2b4a] px-4 text-sm font-semibold text-white" onClick={() => { void Notification.requestPermission(); }}>Enable</button>
      <button type="button" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-muted hover:bg-[#f5f5f5]" onClick={dismiss} aria-label="Dismiss"><X size={18} /></button>
    </div>
  );
}

const MESSAGES: Record<string, (r: Mine) => { title: string; body: string }> = {
  assigned: (r) => ({ title: "Your ride is confirmed", body: `${r.pickup} → ${r.dropoff}${r.driverName ? `. Driver: ${r.driverName}${r.vehiclePlate ? `, ${r.vehiclePlate}` : ""}` : ""}` }),
  cancelled: (r) => ({ title: "Your ride was cancelled", body: `${r.pickup} → ${r.dropoff}` }),
  completed: (r) => ({ title: "Your ride is complete", body: `${r.pickup} → ${r.dropoff}` }),
};

/** Watches the person's rides while the page is open (on every rider page), once notifications are allowed. Draws nothing. */
export function RideAlertsWatcher() {
  const permission = usePermission();
  const seen = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (permission !== "granted") return;
    let stopped = false;
    const check = async () => {
      try {
        const res = await fetch("/api/cabs/rides", { cache: "no-store" });
        if (!res.ok || stopped) return;
        const rides = ((await res.json()) as { rides: Mine[] }).rides;
        const before = seen.current;
        if (before) for (const r of rides) {
          const was = before.get(r.id);
          if (was && was !== r.status && MESSAGES[r.status]) { const m = MESSAGES[r.status](r); new Notification(m.title, { body: m.body, tag: `cab-${r.id}-${r.status}` }); }
        }
        seen.current = new Map(rides.map((r) => [r.id, r.status]));
      } catch { /* offline for a moment: try again next time */ }
    };
    void check();
    const t = setInterval(check, EVERY_MS);
    return () => { stopped = true; clearInterval(t); };
  }, [permission]);
  return null;
}
