"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PhoneMissed } from "lucide-react";
import { Kpi } from "@/components/ivr/ui";
import { formatDuration } from "@/lib/ivr/time";
import type { Kpis } from "@/lib/ivr/stats";

type Payload = { kpis: Kpis };

/** KPIs that refresh every 30 seconds while the tab is in view (and when it comes back), so "active calls" stays live. */
export function KpiStrip({
  initial,
  query,
  variant,
}: {
  initial: Kpis;
  query: string; // e.g. "range=today" or "range=week&user=<id>"
  variant: "agent" | "admin";
}) {
  const [fetched, setFetched] = useState<{ from: Kpis; k: Kpis } | null>(null);
  // A fresh page render wins over a value fetched earlier.
  const k = fetched && fetched.from === initial ? fetched.k : initial;
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/ivr/kpis?${query}`, { cache: "no-store" });
        const json = res.ok ? ((await res.json()) as Payload) : null;
        if (!stopped && json?.kpis) setFetched({ from: initial, k: json.kpis });
      } catch { /* offline for a moment: keep what it shows */ }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    const t = setInterval(load, 30_000);
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, [initial, query]);
  return (
    <div className="ivr-stagger grid grid-cols-2 gap-4 md:grid-cols-4">
      <Kpi label="Active calls" value={k.active} live hint="right now" />
      <Kpi label="Attempted" value={k.attempted} tone="attempted" hint="outbound calls" />
      <Kpi label="Connected" value={k.connected} tone="done" hint="answered calls" />
      <Kpi label="Pick-up rate" value={k.pickupRate === null ? "–" : `${k.pickupRate}%`} hint="outbound answered" />
      <Kpi label="Talk time" value={k.talkSec ? formatDuration(k.talkSec) : "0s"} hint="answered calls" />
      {variant === "agent" ? (
        <Kpi label="Queue" value={k.queue} tone={k.queue ? "incoming" : undefined} hint="members left to call" />
      ) : (
        <Kpi label="Unassigned" value={k.unassigned ?? 0} tone={k.unassigned ? "incoming" : undefined} hint="members need an owner" />
      )}
      <Kpi
        className="col-span-2"
        label="Missed calls"
        value={k.missedOpen}
        tone={k.missedOpen ? "missed" : undefined}
        hint={variant === "agent" ? "inbound, not reached yet · last 30 days" : "inbound, team-wide, not reached yet · last 30 days"}
      >
        <Link className="btn btn-ghost btn-sm mt-1" href={variant === "agent" ? "/ivr/calls?tab=missed" : "/ivr/admin/calls?tab=missed"}>
          <PhoneMissed className="h-3.5 w-3.5" aria-hidden /> See missed calls
        </Link>
      </Kpi>
    </div>
  );
}
