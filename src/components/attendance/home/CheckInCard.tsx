"use client";

import { useEffect, useEffectEvent, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, CheckCircle2, Clock, CloudOff, Home as HomeIcon, Lock, LogIn, LogOut, MapPin, Wifi } from "lucide-react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import type { TodayCard } from "@/lib/attendance/checkin";
import { applyEarlyDepartureAction, cancelRequestAction, checkInAction, checkOutAction } from "@/lib/attendance/actions/staff";
import { checkoutGate, formatWait } from "@/lib/attendance/checkin-rules";
import { formatClockDuration, formatDayCaps, formatHours, istClock12 } from "@/lib/attendance/time";
import { Badge, IconBadge } from "../ui";
import { useAct } from "../use-act";
import { useOnline } from "../pwa/AttPwa";

// ── Location ──────────────────────────────────────────────────────────────

type Fix = { lat: number; lng: number; accuracy: number };
type Loc = { state: "unknown" | "prompt" | "granted" | "denied" | "unavailable"; accuracy?: number };

/** Asks the browser where it is (10 s at most). Without a position the office network may still work. */
function locate(): Promise<{ fix: Fix | null; state: Loc["state"] }> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve({ fix: null, state: "unavailable" });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ fix: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }, state: "granted" }),
      (e) => resolve({ fix: null, state: e.code === e.PERMISSION_DENIED ? "denied" : "unavailable" }),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  });
}

// ── Offline queue ─────────────────────────────────────────────────────────
// A check-in or check-out tapped with no connection is kept on this device and sent when it reconnects. The time recorded is the moment it
// reaches the server (the server never takes a time from the phone), and it must still pass the usual checks then (office network or GPS).

type Queued = { kind: "in" | "out"; userId: string; savedAt: number };
const QUEUE = "att-punch-queue";
const QUEUE_EVENT = "att-queue-change";
const readRaw = () => {
  try {
    return localStorage.getItem(QUEUE);
  } catch {
    return null;
  }
};
const writeQueue = (q: Queued | null) => {
  try {
    if (q) localStorage.setItem(QUEUE, JSON.stringify(q));
    else localStorage.removeItem(QUEUE);
  } catch {
    // private window: nothing kept
  }
  window.dispatchEvent(new Event(QUEUE_EVENT));
};
function useQueued(userId: string): Queued | null {
  const raw = useSyncExternalStore(
    (cb) => {
      window.addEventListener(QUEUE_EVENT, cb);
      window.addEventListener("storage", cb);
      return () => {
        window.removeEventListener(QUEUE_EVENT, cb);
        window.removeEventListener("storage", cb);
      };
    },
    readRaw,
    () => null,
  );
  return useMemo(() => {
    try {
      const q = raw ? (JSON.parse(raw) as Queued) : null;
      return q && q.userId === userId ? q : null;
    } catch {
      return null;
    }
  }, [raw, userId]);
}

const METHOD: Record<string, { label: string; icon: typeof Wifi }> = {
  ip: { label: "Office network", icon: Wifi },
  gps: { label: "At the office (GPS)", icon: MapPin },
  wfh: { label: "Work from home", icon: HomeIcon },
  manual: { label: "Regularized", icon: MapPin },
};

function Line({ label, value, tone = "text-(--att-text)" }: { label: string; value: string; tone?: string }) {
  return (
    <p className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={`font-bold tabular-nums ${tone}`}>{value}</span>
    </p>
  );
}

/**
 * The check-in card: today and the shift; check-in time, time worked (large) and, until check-out opens, a countdown; then Check In or Check
 * Out. Check Out stays disabled until the day's hours are worked (7.5 by default) or a manager or HR approved an early check-out; the server
 * applies the same rules. A tap shows its result at once (it is saving); with no connection it is kept and sent on reconnecting.
 */
export function CheckInCard({ card, userId }: { card: TodayCard; userId: string }) {
  const router = useRouter();
  const toast = useToast();
  const online = useOnline();
  const queued = useQueued(userId);
  const { act, pending: actPending } = useAct();
  const [saving, startSaving] = useTransition();
  const [locating, setLocating] = useState(false);
  const [asking, setAsking] = useState(false);
  const [loc, setLoc] = useState<Loc>({ state: "unknown" });
  /** What was just tapped, shown until the page's data catches up (optimistic). */
  const [local, setLocal] = useState<{ kind: "in" | "out"; at: number } | null>(null);
  // Starts at the server's time (so the first render matches the server's HTML), then follows the browser's clock every second.
  const [now, setNow] = useState(card.serverNow);

  const server = card.record;
  // The tap is shown only until the server's record has it.
  const showIn = local?.kind === "in" && !server?.checkIn;
  const showOut = local?.kind === "out" && !server?.checkOut;
  const checkIn = server?.checkIn ?? (showIn || queued?.kind === "in" ? new Date(local?.at ?? queued?.savedAt ?? now).toISOString() : null);
  const checkOut = server?.checkOut ?? (showOut ? new Date(local!.at).toISOString() : null);
  const open = !!checkIn && !checkOut;

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open]);

  // Location permission, for the hint under the button (where the browser can tell without asking).
  useEffect(() => {
    let live = true;
    navigator.permissions
      ?.query({ name: "geolocation" as PermissionName })
      .then((p) => {
        if (!live) return;
        setLoc((l) => (l.state === "unknown" ? { state: p.state === "granted" ? "granted" : p.state === "denied" ? "denied" : "prompt" } : l));
        p.onchange = () => live && setLoc({ state: p.state === "granted" ? "granted" : p.state === "denied" ? "denied" : "prompt" });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  /** Sends one punch. Returns "ok", "refused" (the server said no: shown) or "offline" (no connection: keep it). */
  const send = async (kind: "in" | "out"): Promise<"ok" | "refused" | "offline"> => {
    setLocating(true);
    const { fix, state } = await locate();
    setLocating(false);
    setLoc(fix ? { state: "granted", accuracy: Math.round(fix.accuracy) } : { state });
    try {
      const r = await (kind === "in" ? checkInAction(fix) : checkOutAction(fix));
      if (!r.ok) {
        toast.error(r.error);
        return "refused";
      }
      toast.success(r.data.message);
      return "ok";
    } catch {
      return "offline";
    }
  };

  const punch = (kind: "in" | "out") => {
    setLocal({ kind, at: Date.now() });
    if (!navigator.onLine) {
      writeQueue({ kind, userId, savedAt: Date.now() });
      return;
    }
    startSaving(async () => {
      const r = await send(kind);
      if (r === "offline") writeQueue({ kind, userId, savedAt: Date.now() });
      else if (r === "refused") setLocal(null);
      else router.refresh();
    });
  };

  // Back online with a kept punch: send it now.
  const flush = useEffectEvent((q: Queued) => {
    startSaving(async () => {
      const r = await send(q.kind);
      if (r === "offline") return;
      writeQueue(null);
      if (r === "refused") setLocal(null);
      router.refresh();
    });
  });
  useEffect(() => {
    if (!online || !queued) return;
    const t = setTimeout(() => flush(queued), 800);
    return () => clearTimeout(t);
  }, [online, queued]);

  const workedMs = checkIn ? (checkOut ? Date.parse(checkOut) : now) - Date.parse(checkIn) : 0;
  const gate = checkoutGate({ workedMs, requiredHours: card.requiredHours, isExtraWork: !!server?.isExtraWork, earlyApproved: card.early?.status === "approved" });
  const onLeave = card.leaveToday === "none";
  const done = !!checkOut;
  const busy = saving || locating || !!queued;
  const label = (idle: string) => (locating ? "Finding your location…" : saving ? "Saving…" : idle);

  const m = server?.method ? METHOD[server.method] : null;
  const marks = [
    card.kind !== "working" && <Badge key="k" tone="purple">{card.holidayName ?? "Weekly off"}</Badge>,
    card.wfhApproved && <Badge key="w" tone="teal">WFH approved</Badge>,
    card.leaveToday && <Badge key="l" tone="blue">{card.leaveToday === "none" ? "On leave" : `Leave: ${card.leaveToday} half`}</Badge>,
    server?.isLate && <Badge key="la" tone="amber">Late</Badge>,
    server?.isEarlyOut && <Badge key="e" tone="amber">Early out</Badge>,
    server?.isExtraWork && <Badge key="x" tone="purple">Extra work</Badge>,
  ].filter(Boolean);

  const locHint =
    card.wfhApproved || done
      ? null
      : loc.state === "denied"
        ? "Location is blocked. Check in on the office Wi-Fi, or allow location for this site in your phone's settings."
        : loc.state === "unavailable"
          ? "Your location could not be found. On the office Wi-Fi you can still check in."
          : loc.accuracy != null
            ? `Location found (±${loc.accuracy} m)${loc.accuracy > 100 ? ": low accuracy, try near a window or use the office Wi-Fi" : ""}.`
            : loc.state === "prompt"
              ? "You will be asked for your location to confirm you are at the office (not needed on the office Wi-Fi)."
              : null;

  return (
    <section className="att-card att-checkin">
      <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1.15fr_1.1fr_auto] lg:items-center lg:gap-6">
        <div className="flex items-start gap-4">
          <IconBadge icon={CalendarDays} tone="green" size={20} />
          <div className="min-w-0">
            <p className="text-lg font-extrabold tracking-wide text-[var(--att-primary)]">{formatDayCaps(card.today)}</p>
            <p className="text-sm text-gray-500">
              {card.shift.name} shift · {card.shift.startTime}–{card.shift.endTime} (grace {card.shift.graceMinutes} min)
            </p>
            {marks.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{marks}</div>}
          </div>
        </div>

        <div className="flex items-start gap-4 lg:border-l lg:border-[var(--att-line)] lg:pl-6">
          <span className="hidden lg:inline-grid">
            <IconBadge icon={Clock} tone="grey" size={20} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="text-center lg:text-left">
              <p className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-gray-500">Time worked</p>
              <p className="att-timer">{formatClockDuration(workedMs / 1000)}</p>
            </div>
            {checkIn && <Line label="Check In" value={istClock12(checkIn)} />}
            {checkOut && <Line label="Check Out" value={istClock12(checkOut)} />}
            {open && !gate.allowed && !queued && (
              <p className="flex items-baseline justify-between gap-4 text-sm" aria-live="polite">
                <span className="text-gray-500">Check out available in</span>
                <span className="font-bold tabular-nums text-[#b45309]">{formatClockDuration(gate.remainingMs / 1000)}</span>
              </p>
            )}
            {server?.checkOut && server.hoursWorked != null && <p className="text-xs text-gray-500">{formatHours(server.hoursWorked)} recorded</p>}
            {m && (
              <p className="inline-flex items-center gap-1 text-xs text-gray-500">
                <m.icon size={12} aria-hidden /> {m.label}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 lg:items-end">
          {queued ? (
            <span className="att-queued">
              <CloudOff size={18} aria-hidden /> {queued.kind === "in" ? "Check-in" : "Check-out"} saved: sent when you are back online
            </span>
          ) : done ? (
            <span className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--att-primary-tint)] px-5 py-3 text-sm font-bold text-[var(--att-primary-2)]">
              <CheckCircle2 size={18} aria-hidden /> Done for today
            </span>
          ) : open ? (
            <>
              <button type="button" onClick={() => punch("out")} disabled={busy || !gate.allowed} className={gate.allowed ? "att-btn-in" : "att-btn-out"}>
                {gate.allowed ? <LogOut size={18} aria-hidden /> : <Lock size={16} aria-hidden />} {label("Check Out")}
              </button>
              {!gate.allowed && (
                <p className="text-center text-xs text-gray-500 lg:text-right">
                  Opens after {formatHours(card.requiredHours)} worked (in {formatWait(gate.remainingMs)}).
                  {!card.early && (
                    <>
                      {" "}
                      <button type="button" className="att-link-btn" onClick={() => setAsking(true)}>
                        Need to leave early?
                      </button>
                    </>
                  )}
                </p>
              )}
              {card.early?.status === "pending" && (
                <p className="text-center text-xs text-[#b45309] lg:max-w-[16rem] lg:text-right">
                  Early check-out asked, waiting for {card.approver.replace(/ \(.*\)$/, "")}.{" "}
                  <button type="button" className="att-link-btn" disabled={actPending} onClick={() => act(() => cancelRequestAction("early", card.early!.id))}>
                    Withdraw
                  </button>
                </p>
              )}
              {card.early?.status === "approved" && <p className="text-center text-xs font-semibold text-[var(--att-primary-2)] lg:text-right">Early check-out approved.</p>}
              {card.early?.status === "rejected" && (
                <p className="text-center text-xs text-[var(--att-red)] lg:max-w-[16rem] lg:text-right">Early check-out not approved{card.early.remark ? `: “${card.early.remark}”` : "."}</p>
              )}
            </>
          ) : (
            <button type="button" onClick={() => punch("in")} disabled={busy || onLeave} className="att-btn-in">
              <LogIn size={18} aria-hidden /> {label("Check In")}
            </button>
          )}
          {locHint && !queued && (
            <p className={`flex items-start gap-1.5 text-xs lg:max-w-[16rem] lg:text-right ${loc.state === "denied" || loc.state === "unavailable" ? "text-[#b45309]" : "text-gray-500"}`}>
              <MapPin size={13} className="mt-px shrink-0" aria-hidden /> {locHint}
            </p>
          )}
        </div>
      </div>
      <p className="rounded-b-2xl border-t border-[var(--att-line)] bg-(--att-bg) px-5 py-3 text-xs text-gray-500 sm:px-6">
        {onLeave
          ? "You are on leave today. Cancel the leave on the Leave page if you are working."
          : card.kind !== "working" && !server
            ? "Today is not a working day: checking in records extra work, which you can claim as a comp-off."
            : card.wfhApproved && !server
              ? "Work from home is approved for today: you can check in from anywhere."
              : "Check in from the office: on the office network, or with your phone's location within the office."}
      </p>
      {asking && <EarlyDialog approver={card.approver} onClose={() => setAsking(false)} />}
    </section>
  );
}

function EarlyDialog({ approver, onClose }: { approver: string; onClose: () => void }) {
  const { act, pending } = useAct();
  const [reason, setReason] = useState("");
  return (
    <Modal title="Ask to check out early" onClose={onClose}>
      <p className="text-sm text-gray-600">Goes to {approver}. Once approved, Check Out opens straight away.</p>
      <label className="mt-3 flex flex-col gap-1 text-xs font-semibold text-gray-500">
        Reason
        <textarea className="input" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={pending || reason.trim().length < 3}
          onClick={async () => {
            const r = await act(() => applyEarlyDepartureAction(reason));
            if (r.ok) onClose();
          }}
        >
          Send request
        </button>
      </div>
    </Modal>
  );
}
