"use client";

import { useEffect, useState } from "react";
import { PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { formatDuration } from "@/lib/ivr/time";
import type { ActiveCall } from "@/lib/ivr/stats";

/** Calls in progress, each with its caller and a running clock. The list itself is refreshed by the KPI strip. */
export function ActiveCalls({ calls }: { calls: ActiveCall[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!calls.length) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [calls.length]);

  return (
    <section className="ivr-card overflow-hidden" aria-live="polite">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
        <h2 className="flex items-center gap-2 text-[1.1rem]">
          {calls.length > 0 && <span className="ivr-live-dot h-2.5 w-2.5 rounded-full bg-brand-green" aria-hidden />}
          Calls in progress
        </h2>
        <p className="text-[0.78rem] text-muted">Updates every 10 seconds</p>
      </div>
      {calls.length === 0 ? (
        <p className="px-5 py-4 text-[13px] text-muted">No calls right now.</p>
      ) : (
        <ul className="divide-y divide-line">
          {calls.map((c) => {
            const Icon = c.direction === "outbound" ? PhoneOutgoing : PhoneIncoming;
            return (
              <li key={c.callId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-[13px]">
                <Icon className="h-4 w-4 shrink-0 text-primary" aria-label={c.direction === "outbound" ? "Outbound" : "Inbound"} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold tabular-nums text-ink">{c.customerNumber}</span>
                  <span className="block truncate text-[12px] text-muted">
                    {c.memberName ?? "Unknown caller"} · {c.agentName ?? "Agent not linked yet"}
                  </span>
                </span>
                <span className="tabular-nums font-semibold text-brand-green-text" title="Time since the call started" suppressHydrationWarning>
                  {formatDuration(Math.max(0, Math.floor((now - c.startedAtMs) / 1000)))}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
