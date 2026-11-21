"use client";

import { useEffect, useState } from "react";
import { MapPin, Wifi, Home as HomeIcon } from "lucide-react";
import type { TodayCard } from "@/lib/attendance/checkin";
import { checkInAction, checkOutAction } from "@/lib/attendance/actions/staff";
import { formatClockDuration, formatDayShort, formatHours, istClock } from "@/lib/attendance/time";
import { Badge } from "../ui";
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

/** The check-in card: the big button, today's time worked (ticking while checked in), the shift and today's marks. */
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
  return (
    <section className="att-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--att-line)] px-5 py-3">
        <div>
          <p className="att-label">{formatDayShort(card.today)}</p>
          <p className="text-sm font-semibold text-ink">
            {card.shift.name} shift · {card.shift.startTime}–{card.shift.endTime} <span className="att-muted font-normal">(grace {card.shift.graceMinutes} min)</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {card.kind !== "working" && <Badge tone="purple">{card.holidayName ?? "Weekly off"}</Badge>}
          {card.wfhApproved && <Badge tone="teal">WFH approved</Badge>}
          {card.leaveToday && <Badge tone="blue">{card.leaveToday === "none" ? "On leave" : `Leave: ${card.leaveToday} half`}</Badge>}
          {r?.isLate && <Badge tone="amber">Late</Badge>}
          {r?.isEarlyOut && <Badge tone="amber">Early out</Badge>}
          {r?.isExtraWork && <Badge tone="purple">Extra work</Badge>}
        </div>
      </div>
      <div className="flex flex-col items-center gap-4 px-5 py-7 sm:flex-row sm:justify-around">
        <div className="text-center">
          <p className="att-label">Time worked today</p>
          <p className="att-timer" aria-live="off">
            {formatClockDuration(seconds)}
          </p>
          {r?.checkIn && (
            <p className="mt-1 text-sm att-muted">
              In {istClock(r.checkIn)}
              {r.checkOut && ` · Out ${istClock(r.checkOut)} · ${formatHours(r.hoursWorked)}`}
            </p>
          )}
          {m && (
            <p className="mt-1 inline-flex items-center gap-1 text-xs att-muted">
              <m.icon size={13} aria-hidden /> {m.label}
            </p>
          )}
        </div>
        {done ? (
          <div className="grid h-[11rem] w-[11rem] place-items-center rounded-full border-2 border-dashed border-[var(--att-line)] text-center text-sm font-semibold att-muted">
            Done for
            <br />
            today
          </div>
        ) : (
          <button type="button" onClick={punch} disabled={busy || onLeave} className={`att-punch ${open ? "att-punch-out" : "att-punch-in"}`}>
            {locating ? "Locating…" : pending ? "Saving…" : open ? "CHECK OUT" : "CHECK IN"}
          </button>
        )}
      </div>
      <p className="border-t border-[var(--att-line)] bg-[var(--att-grey-tint)] px-5 py-2.5 text-xs att-muted">
        {onLeave
          ? "You are on leave today. Cancel the leave on the Leave page if you are working."
          : card.kind !== "working" && !r
            ? "Today is not a working day: checking in records extra work, which you can claim as a comp-off."
            : card.wfhApproved && !r
              ? "Work from home is approved for today: you can check in from anywhere."
              : "Check in from the office: on the office network, or with your phone's location within the office."}
      </p>
    </section>
  );
}
