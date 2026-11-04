"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ActivityItem } from "@/lib/aistudio/queries";
import { formatDateTime } from "./ui";

/**
 * What just happened: new requests, status moves, assignments, notes and deliverables. Refreshes every 15 seconds while the tab is open (and at once
 * when it comes back), and marks what arrived since the page was opened. Every request (the AI Studio team sees them all).
 */
export function ActivityFeed({ initial, title = "Recent activity" }: { initial: ActivityItem[]; title?: string }) {
  const [items, setItems] = useState(initial);
  const [seen] = useState(() => new Set(initial.map((i) => i.id)));
  useEffect(() => {
    let stop = false;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/aistudio/activity`, { cache: "no-store" });
        if (res.ok && !stop) setItems(((await res.json()) as { items: ActivityItem[] }).items);
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
  }, []);

  return (
    <section className="ai-card" aria-live="polite">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--ai-line)] px-5 py-3.5">
        <h2 className="flex items-center gap-2 text-[1.02rem] font-bold text-ink">
          <span className="ai-live" aria-hidden />
          {title}
        </h2>
        <span className="text-xs ai-muted">Updates every 15 seconds</span>
      </div>
      {items.length === 0 ? (
        <p className="px-5 py-6 text-sm ai-muted">Nothing has happened yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--ai-line)]">
          {items.map((i) => (
            <li key={i.id} className="flex items-start gap-3 px-5 py-2.5 text-sm">
              {!seen.has(i.id) && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--ai-green)]" aria-label="New" />}
              <span className="min-w-0 flex-1">
                <Link href={`/aistudio/admin/requests/${i.requestId}`} className="font-semibold text-[var(--ai-navy)] hover:underline">
                  {i.number}
                </Link>{" "}
                <span className="text-ink">{i.text}</span>
                <span className="block truncate text-xs ai-muted">{i.title}</span>
              </span>
              <time className="shrink-0 text-xs ai-muted" dateTime={i.at} suppressHydrationWarning>
                {formatDateTime(i.at)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
