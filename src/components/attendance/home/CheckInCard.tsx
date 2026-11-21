"use client";

import { useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, Clock, Home as HomeIcon, LogIn, LogOut, MapPin, Wifi } from "lucide-react";
import { Modal } from "@/components/Modal";
import type { TodayCard } from "@/lib/attendance/checkin";
import { applyEarlyDepartureAction, cancelRequestAction, checkInAction, checkOutAction } from "@/lib/attendance/actions/staff";
import { checkoutGate } from "@/lib/attendance/checkin-rules";
import { formatClockDuration, formatDayCaps, formatHours, istClock12 } from "@/lib/attendance/time";
import { Badge, IconBadge } from "../ui";
import { useAct } from "../use-act";

/** Asks the browser where it is (10 s at most). Null when it cannot or will not say: the office network may still work. */
function position(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  });
}

const METHOD: Record<string, { label: string; icon: typeof Wifi }> = {
  ip: { label: "Office network", icon: Wifi },
  gps: { label: "At the office (GPS)", icon: MapPin },
  wfh: { label: "Work from home", icon: HomeIcon },
  manual: { label: "Regularized", icon: MapPin },
};

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <p className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={`tabular-nums ${strong ? "text-2xl font-extrabold text-gray-900" : "font-bold text-gray-900"}`}>{value}</span>
    </p>
  );
}

/**
 * The check-in card, in three parts: today and the shift (left); check-in time, time worked today and, until check-out opens, a countdown
 * (middle); Check In, or Check Out (right). Check Out stays disabled until the day's hours are worked (7.5 by default) or a manager or HR
 * has approved an early check-out. The server applies the same rules (checkin-rules.ts checkoutGate).
 */
export function CheckInCard({ card }: { card: TodayCard }) {
  const { act, pending } = useAct();
  const [locating, setLocating] = useState(false);
  const [asking, setAsking] = useState(false);
  // Starts at the server's time (so the first render matches the server's HTML), then follows the browser's clock every second.
  const [now, setNow] = useState(card.serverNow);
  const r = card.record;
  const open = !!r?.checkIn && !r.checkOut;
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open]);

  const workedMs = r?.checkIn ? (r.checkOut ? Date.parse(r.checkOut) : now) - Date.parse(r.checkIn) : 0;
  const gate = checkoutGate({ workedMs, requiredHours: card.requiredHours, isExtraWork: !!r?.isExtraWork, earlyApproved: card.early?.status === "approved" });
  const onLeave = card.leaveToday === "none";
  const done = !!r?.checkOut;
  const busy = pending || locating;

  const punch = async () => {
    setLocating(true);
    const p = await position();
    setLocating(false);
    await act(() => (open ? checkOutAction(p) : checkInAction(p)).then((res) => (res.ok ? { ...res, message: res.data.message } : res)));
  };

  const m = r?.method ? METHOD[r.method] : null;
  const marks = [
    card.kind !== "working" && <Badge key="k" tone="purple">{card.holidayName ?? "Weekly off"}</Badge>,
    card.wfhApproved && <Badge key="w" tone="teal">WFH approved</Badge>,
    card.leaveToday && <Badge key="l" tone="blue">{card.leaveToday === "none" ? "On leave" : `Leave: ${card.leaveToday} half`}</Badge>,
    r?.isLate && <Badge key="la" tone="amber">Late</Badge>,
    r?.isEarlyOut && <Badge key="e" tone="amber">Early out</Badge>,
    r?.isExtraWork && <Badge key="x" tone="purple">Extra work</Badge>,
  ].filter(Boolean);
  const label = (idle: string) => (locating ? "Locating…" : pending ? "Saving…" : idle);

  return (
    <section className="att-card">
      <div className="grid gap-6 p-6 md:grid-cols-[1.2fr_1.1fr_auto] md:items-center">
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

        <div className="flex items-start gap-4 md:border-l md:border-[var(--att-line)] md:pl-6">
          <IconBadge icon={Clock} tone="grey" size={20} />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {r?.checkIn ? (
              <>
                <Line label="Check In" value={istClock12(r.checkIn)} />
                {r.checkOut && <Line label="Check Out" value={istClock12(r.checkOut)} />}
                <Line label="Time worked" value={formatClockDuration(workedMs / 1000)} strong />
                {open && !gate.allowed && (
                  <p className="flex items-baseline justify-between gap-4 text-sm" aria-live="polite">
                    <span className="text-gray-500">Check out available in</span>
                    <span className="font-bold tabular-nums text-[#b45309]">{formatClockDuration(gate.remainingMs / 1000)}</span>
                  </p>
                )}
                {r.checkOut && r.hoursWorked != null && <p className="text-xs text-gray-500">{formatHours(r.hoursWorked)} recorded</p>}
                {m && (
                  <p className="inline-flex items-center gap-1 text-xs text-gray-500">
                    <m.icon size={12} aria-hidden /> {m.label}
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-gray-500">Time worked today</p>
                <p className="att-timer">00:00:00</p>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 md:items-end">
          {done ? (
            <span className="inline-flex items-center gap-2 rounded-xl bg-[var(--att-primary-tint)] px-5 py-3 text-sm font-bold text-[var(--att-primary-2)]">
              <CheckCircle2 size={18} aria-hidden /> Done for today
            </span>
          ) : open ? (
            <>
              <button type="button" onClick={punch} disabled={busy || !gate.allowed} className={gate.allowed ? "att-btn-in" : "att-btn-out"}>
                <LogOut size={18} aria-hidden /> {label("Check Out")}
              </button>
              {!gate.allowed && (
                <p className="text-xs text-gray-500 md:text-right">
                  Opens after {formatHours(card.requiredHours)} worked.
                  {!card.early && (
                    <>
                      {" "}
                      <button type="button" className="font-semibold text-[var(--att-primary-2)] hover:underline" onClick={() => setAsking(true)}>
                        Need to leave early?
                      </button>
                    </>
                  )}
                </p>
              )}
              {card.early?.status === "pending" && (
                <p className="max-w-[16rem] text-xs text-[#b45309] md:text-right">
                  Early check-out asked, waiting for {card.approver.replace(/ \(.*\)$/, "")}.{" "}
                  <button type="button" className="font-semibold underline" disabled={pending} onClick={() => act(() => cancelRequestAction("early", card.early!.id))}>
                    Withdraw
                  </button>
                </p>
              )}
              {card.early?.status === "approved" && <p className="text-xs font-semibold text-[var(--att-primary-2)] md:text-right">Early check-out approved.</p>}
              {card.early?.status === "rejected" && (
                <p className="max-w-[16rem] text-xs text-[var(--att-red)] md:text-right">Early check-out not approved{card.early.remark ? `: “${card.early.remark}”` : "."}</p>
              )}
            </>
          ) : (
            <button type="button" onClick={punch} disabled={busy || onLeave} className="att-btn-in">
              <LogIn size={18} aria-hidden /> {label("Check In")}
            </button>
          )}
        </div>
      </div>
      <p className="rounded-b-2xl border-t border-[var(--att-line)] bg-gray-50 px-6 py-3 text-xs text-gray-500">
        {onLeave
          ? "You are on leave today. Cancel the leave on the Leave page if you are working."
          : card.kind !== "working" && !r
            ? "Today is not a working day: checking in records extra work, which you can claim as a comp-off."
            : card.wfhApproved && !r
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
