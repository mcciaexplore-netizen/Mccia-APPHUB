"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

const EVERY_MS = 60_000;
/** Sent on window when notifications were marked read here (NotificationList), so the bell counts again at once. */
export const NOTICES_CHANGED = "hub:notices-changed";

/**
 * The hub's bell: everything addressed to this person (the hub's own notices, Cab Booking's, the Approval System's), with the unread count,
 * opening /notifications. Shown in the hub's top bar and in the frame of every application built into the hub, so a notice is seen wherever
 * the person is working (src/lib/notice-feed.ts counts it). An application's frame stays on screen while its pages change, so the count
 * keeps itself current: every minute while the tab is in view, at once when the person comes back to it, and when notifications are marked
 * read. A hidden tab asks nothing.
 */
export function HubBell({ unread: initial }: { unread: number }) {
  const [fetched, setFetched] = useState<{ from: number; n: number } | null>(null);
  // A fresh count from the server (a page load) wins over one fetched earlier.
  const unread = fetched && fetched.from === initial ? fetched.n : initial;
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/notifications/unread", { cache: "no-store" });
        const json = res.ok ? ((await res.json()) as { unread?: number }) : null;
        if (!stopped && typeof json?.unread === "number") setFetched({ from: initial, n: json.unread });
      } catch { /* offline for a moment: keep what it shows */ }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    const changed = () => void load();
    const t = setInterval(load, EVERY_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(NOTICES_CHANGED, changed);
    return () => { stopped = true; clearInterval(t); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener(NOTICES_CHANGED, changed); };
  }, [initial]);
  return (
    <Link href="/notifications" data-hub-bell data-unread={unread} aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"} className="relative grid h-10 w-10 place-items-center rounded-md text-muted transition-colors hover:bg-alt hover:text-primary">
      <Bell size={20} />
      {unread > 0 && <span className="absolute right-1 top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-brand-red px-1 text-[0.62rem] font-bold leading-none text-white">{unread > 99 ? "99+" : unread}</span>}
    </Link>
  );
}
