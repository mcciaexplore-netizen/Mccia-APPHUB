"use client";

import { useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, Clock, Home as HomeIcon, LogIn, LogOut, MapPin, Wifi } from "lucide-react";
import type { TodayCard } from "@/lib/attendance/checkin";
import { checkInAction, checkOutAction } from "@/lib/attendance/actions/staff";
import { formatClockDuration, formatDayCaps, formatHours, istClock } from "@/lib/attendance/time";
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

/**
 * The check-in card, in three parts: today and the shift (left), time worked today, ticking while checked in (middle), and Login (check in)
 * or Logout (check out) (right). The rules (office network, 150 m of the office, WFH, one punch each per day) are on the server.
 */
export function CheckInCard({ card }: { card: TodayCard }) {
  const { act, pending } = useAct();
  const [locating, setLocating] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const r = card.record;
  const open = !!r?.checkIn && !r.checkOut;
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open]);

  const seconds = r?.checkIn ? ((r.checkOut ? Date.parse(r.checkOut) : now) - Date.parse(r.checkIn)) / 1000 : 0;
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

  return (
    <section className="att-card">
      <div className="grid gap-6 p-6 md:grid-cols-[1.3fr_1fr_auto] md:items-center">
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
          <div>
            <p className="text-[0.7rem] font-bold uppercase tracking-[0.12em] text-gray-500">Time worked today</p>
            <p className="att-timer">{formatClockDuration(seconds)}</p>
            {r?.checkIn && (
              <p className="mt-0.5 text-xs text-gray-500">
                In {istClock(r.checkIn)}
                {r.checkOut && ` · Out ${istClock(r.checkOut)} · ${formatHours(r.hoursWorked)}`}
                {m && (
                  <span className="ml-1 inline-flex items-center gap-1">
                    · <m.icon size={12} aria-hidden /> {m.label}
                  </span>
                )}
              </p>
            )}
          </div>
        </div>

        <div className="flex md:justify-end">
          {done ? (
            <span className="inline-flex items-center gap-2 rounded-xl bg-[var(--att-primary-tint)] px-5 py-3 text-sm font-bold text-[var(--att-primary-2)]">
              <CheckCircle2 size={18} aria-hidden /> Done for today
            </span>
          ) : open ? (
            <button type="button" onClick={punch} disabled={busy} className="att-btn-out" title="Check out">
              <LogOut size={18} aria-hidden /> {locating ? "Locating…" : pending ? "Saving…" : "Logout"}
            </button>
          ) : (
            <button type="button" onClick={punch} disabled={busy || onLeave} className="att-btn-in" title="Check in">
              <LogIn size={18} aria-hidden /> {locating ? "Locating…" : pending ? "Saving…" : "Login"}
            </button>
          )}
        </div>
      </div>
      <p className="rounded-b-2xl border-t border-[var(--att-line)] bg-gray-50 px-6 py-3 text-xs text-gray-500">
        {onLeave
          ? "You are on leave today. Cancel the leave on the Leave page if you are working."
          : card.kind !== "working" && !r
            ? "Today is not a working day: logging in records extra work, which you can claim as a comp-off."
            : card.wfhApproved && !r
              ? "Work from home is approved for today: you can log in from anywhere."
              : "Log in from the office: on the office network, or with your phone's location within the office."}
      </p>
    </section>
  );
}
