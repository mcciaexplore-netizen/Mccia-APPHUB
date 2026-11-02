"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ActivityDto } from "@/lib/design/detail";
import { formatDateTime } from "./ui";

/**
 * What just happened: new requests, stage moves, reviews sent and decided. Refreshes every 15 seconds while the tab is open (and at once
 * when it comes back), and marks what arrived since the page was opened. `scope="mine"` is the designer's own tickets; "all" (leads) every
 * ticket. The server enforces the scope either way.
 */
export function ActivityFeed({ scope, initial, title = "Live activity" }: { scope: "mine" | "all"; initial: ActivityDto[]; title?: string }) {
  const [items, setItems] = useState(initial);
  const [seen] = useState(() => new Set(initial.map((i) => i.id)));
  useEffect(() => {
    let stop = false;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/design/activity?scope=${scope}`, { cache: "no-store" });
        if (res.ok && !stop) setItems(((await res.json()) as { items: ActivityDto[] }).items);
      } catch {
        // the next poll tries again
      }
    };
    const t = setInterval(load, 15_000);
    document.addEventListener("visibilitychange", load);
    return () => {
      stop = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", load);
    };
  }, [scope]);

  return (
    <section className="ds-card" aria-live="polite">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--ds-line)] px-5 py-3.5">
        <h2 className="flex items-center gap-2 text-[1.02rem] font-bold text-ink">
          <span className="ds-live" aria-hidden />
          {title}
        </h2>
        <span className="text-xs ds-muted">Updates every 15 seconds</span>
      </div>
      {items.length === 0 ? (
        <p className="px-5 py-6 text-sm ds-muted">Nothing has happened yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--ds-line)]">
          {items.map((i) => (
            <li key={i.id} className="flex items-start gap-3 px-5 py-2.5 text-sm">
              {!seen.has(i.id) && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--ds-green)]" aria-label="New" />}
              <span className="min-w-0 flex-1">
                <Link href={`/design/tickets/${i.ticketId}`} className="font-semibold text-[var(--ds-navy)] hover:underline">
                  {i.number}
                </Link>{" "}
                <span className="text-ink">{i.text}</span>
                <span className="block truncate text-xs ds-muted">{i.title}</span>
              </span>
              <time className="shrink-0 text-xs ds-muted" dateTime={i.at} suppressHydrationWarning>
                {formatDateTime(i.at)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
