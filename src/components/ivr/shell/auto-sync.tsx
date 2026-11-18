"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { cx as clsx } from "@/lib/ivr/cx";

type Tick =
  | { ran: true; ok: true; fetched: number; upserted: number; newLeads: number; lastSyncAt: string }
  | { ran: true; ok: false; error: string; lastSyncAt: string | null }
  | { ran: false; reason: string; lastSyncAt: string | null };

const BEAT_MS = 60_000;
const SLOW_MS = 10 * 60_000;
/** How often an open page asks whether a call it shows has changed (a webhook saved a finished call). */
const WATCH_MS = 5_000;
/** The same outside working hours (few calls end then), or while the last ask failed. */
const WATCH_SLOW_MS = 30_000;

function ago(iso: string | null, now: number): string {
  if (!iso) return "not yet";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

/**
 * Keeps call data fresh while the app is open:
 *   - every minute it asks the server to sync from Smartflo (the server throttles and runs only one sync for all tabs), refreshes the page
 *     data when new calls arrived, and shows when the last sync happened;
 *   - every few seconds it asks whether a call the person can see has changed (`scope`: "team" on the admin pages, "own" for an agent),
 *     and refreshes the page when one has, so a finished call Smartflo sends by webhook shows within seconds.
 * Both stop while the tab is hidden and catch up the moment it is shown again.
 */
export function AutoSync({ initialLastSyncAt, scope = "own" }: { initialLastSyncAt: string | null; scope?: "own" | "team" }) {
  const router = useRouter();
  const [last, setLast] = useState<string | null>(initialLastSyncAt);
  const [state, setState] = useState<"idle" | "busy" | "error" | "off">("idle");
  const [now, setNow] = useState(() => Date.now());
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The last "calls changed at" this page has shown: undefined until the first answer (which is the baseline, not a change). */
  const seenChange = useRef<string | null | undefined>(undefined);
  const quiet = useRef(false);

  const tick = useCallback(
    async (manual: boolean) => {
      if (busy.current) return BEAT_MS;
      busy.current = true;
      if (manual) setState("busy");
      let next = BEAT_MS;
      try {
        const res = await fetch("/api/ivr/sync/tick", { method: manual ? "PUT" : "POST", cache: "no-store" });
        if (res.status === 401) {
          router.refresh();
          return SLOW_MS;
        }
        const t = (await res.json()) as Tick;
        if (t.lastSyncAt) setLast(t.lastSyncAt);
        if (t.ran && t.ok) {
          setState("idle");
          if (t.upserted > 0) {
            router.refresh();
            seenChange.current = undefined; // that refresh shows everything; take the next answer as the new baseline
          }
        } else if (t.ran) {
          setState("error");
        } else {
          setState(t.reason === "after_hours" || t.reason === "disabled" ? "off" : "idle");
          quiet.current = t.reason === "after_hours" || t.reason === "disabled";
          if (t.reason === "after_hours" || t.reason === "disabled" || t.reason === "not_connected") next = SLOW_MS;
        }
      } catch {
        setState("error");
      } finally {
        busy.current = false;
      }
      return next;
    },
    [router],
  );

  useEffect(() => {
    let stopped = false;
    const loop = async () => {
      if (stopped) return;
      // Hidden tabs do nothing; they catch up the moment the tab is shown again.
      const wait = document.visibilityState === "visible" ? await tick(false) : BEAT_MS;
      if (!stopped) timer.current = setTimeout(loop, wait + Math.random() * 5000);
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (timer.current) clearTimeout(timer.current);
      void loop();
    };
    void loop();
    document.addEventListener("visibilitychange", onVisible);
    const clock = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      stopped = true;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(clock);
    };
  }, [tick]);

  // The few-seconds check for calls saved by webhook. Cheap: one indexed query on the server, no Smartflo request.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = async (): Promise<number> => {
      try {
        const res = await fetch(`/api/ivr/sync/changes?scope=${scope}`, { cache: "no-store" });
        if (res.status === 401 || res.status === 403 || res.status === 404) return SLOW_MS;
        if (!res.ok) return WATCH_SLOW_MS;
        const { changedAt } = (await res.json()) as { changedAt: string | null };
        if (seenChange.current === undefined) seenChange.current = changedAt;
        else if (changedAt !== seenChange.current) {
          seenChange.current = changedAt;
          router.refresh();
        }
      } catch {
        return WATCH_SLOW_MS;
      }
      return quiet.current ? WATCH_SLOW_MS : WATCH_MS;
    };
    const loop = async () => {
      if (stopped) return;
      const wait = document.visibilityState === "visible" ? await check() : WATCH_MS;
      if (!stopped) timer = setTimeout(loop, wait + Math.random() * 1000);
    };
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (timer) clearTimeout(timer);
      void loop();
    };
    void loop();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, scope]);

  const label =
    state === "error" ? "Sync problem, retrying" : state === "busy" ? "Syncing calls…" : `Calls synced ${ago(last, now)}${state === "off" ? " (auto-sync paused)" : ""}`;

  return (
    <button
      type="button"
      onClick={() => void tick(true)}
      title="Fetch the latest calls from Smartflo now"
      className={clsx(
        "fixed right-3 bottom-3 z-30 flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-[12px] text-muted shadow-sm hover:text-ink",
        state === "error" && "border-red-300 text-red-700",
      )}
    >
      <RefreshCw className={clsx("h-3.5 w-3.5", state === "busy" && "animate-spin")} aria-hidden />
      <span aria-live="polite">{label}</span>
    </button>
  );
}
