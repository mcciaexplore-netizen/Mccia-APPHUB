"use client";

import { AlertTriangle, ArrowRight, CalendarClock, CalendarDays, CalendarPlus, CheckCircle2, ChevronLeft, ChevronRight, Clock, Hourglass } from "lucide-react";
import { useState } from "react";
import { Modal } from "@/components/Modal";
import { applyPlanAction, applyRegularizationAction, cancelRequestAction } from "@/lib/attendance/actions/staff";
import { PAST_CARD_TEXT } from "@/lib/attendance/regularization";
import type { CalendarRange, PastDayCard, PlanCard } from "@/lib/attendance/requests";
import { eachDay, formatDay, formatMonth, monthRange, shiftMonth, weekday, weekdayName } from "@/lib/attendance/time";
import { hm12 } from "@/lib/attendance/time-wheel";
import { TimePicker } from "../TimePicker";
import { Badge, Card, Empty } from "../ui";
import { useAct } from "../use-act";

/**
 * The Regularization page's two lists of day cards: past working days with a missed punch (to correct), and the working days ahead (to
 * plan). Each opens one dialog with the scroll time pickers. Five or more cards on a phone become a row to swipe.
 */

const longDay = (day: string) => `${weekdayName(day)}, ${formatDay(day)}`;
const SWIPE_FROM = 5;
const grid = (n: number) => `att-cards${n >= SWIPE_FROM ? " att-cards-swipe" : ""}`;

type Open = { kind: "past"; card: PastDayCard } | { kind: "plan"; day: string } | null;

export function RegularizationView({ past, plans, approver, windowDays, aheadDays, cal }: { past: PastDayCard[]; plans: PlanCard[]; approver: string; windowDays: number; aheadDays: number; cal: CalendarRange }) {
  const [open, setOpen] = useState<Open>(null);
  return (
    <>
      <RegCalendar past={past} plans={plans} cal={cal} onOpen={setOpen} />

      <Card title="Missed punches" subtitle={`Working days in the last ${windowDays} days with a check-in or check-out missing.`} icon={Clock} iconTone="orange">
        {past.length ? (
          <div className={grid(past.length)} data-testid="reg-past">
            {past.map((c) => (
              <PastCard key={c.day} card={c} onOpen={() => setOpen({ kind: "past", card: c })} />
            ))}
          </div>
        ) : (
          <Empty title="Nothing to correct">In the last {windowDays} days there is no working day with a missed check-in or check-out.</Empty>
        )}
      </Card>

      <Card title="Planned working days" subtitle={`The next ${aheadDays} days. Plan your hours for a day ahead; ${approver} approves.`} icon={CalendarClock} iconTone="blue">
        {plans.length ? (
          <div className={grid(plans.length)} data-testid="reg-plans">
            {plans.map((p) => (
              <PlanDayCard key={p.day} card={p} onOpen={() => setOpen({ kind: "plan", day: p.day })} />
            ))}
          </div>
        ) : (
          <Empty title="No working days ahead">There is no working day in the next {aheadDays} days that can be planned.</Empty>
        )}
      </Card>

      {open?.kind === "past" && <PastDialog card={open.card} approver={approver} onClose={() => setOpen(null)} />}
      {open?.kind === "plan" && <PlanDialog day={open.day} approver={approver} onClose={() => setOpen(null)} />}
    </>
  );
}

function PastCard({ card, onOpen }: { card: PastDayCard; onOpen: () => void }) {
  const text = PAST_CARD_TEXT[card.state];
  const asked = card.state === "pending" || card.state === "regularized";
  return (
    <article className={`att-daycard ${asked ? "att-daycard-muted" : "att-daycard-warn"}`} data-testid="reg-day" data-day={card.day} data-state={card.state}>
      <p className="font-bold text-(--att-text)">{longDay(card.day)}</p>
      <p className={`flex items-center gap-1.5 text-sm font-semibold ${asked ? "" : "text-(--att-amber-text)"}`}>
        {card.state === "regularized" ? <CheckCircle2 size={15} aria-hidden /> : card.state === "pending" ? <Hourglass size={15} aria-hidden /> : <AlertTriangle size={15} aria-hidden />}
        {text.label}
      </p>
      {asked ? (
        <p className="text-sm">
          {[card.checkIn && `In ${hm12(card.checkIn)}`, card.checkOut && `Out ${hm12(card.checkOut)}`].filter(Boolean).join(" · ") || "Times as asked"}
        </p>
      ) : (
        <>
          {card.checkIn && <p className="text-sm att-muted">Checked in: {hm12(card.checkIn)}</p>}
          {card.checkOut && <p className="text-sm att-muted">Checked out: {hm12(card.checkOut)}</p>}
          {!card.checkIn && !card.checkOut && <p className="text-sm att-muted">No check-in or check-out recorded</p>}
        </>
      )}
      {text.action && (
        <button type="button" className="btn btn-primary btn-sm mt-2 w-full" onClick={onOpen}>
          {text.action}
        </button>
      )}
    </article>
  );
}

function PlanDayCard({ card, onOpen }: { card: PlanCard; onOpen: () => void }) {
  const { act, pending } = useAct();
  const p = card.plan;
  const live = p && p.status !== "rejected";
  return (
    <article className={`att-daycard ${p?.status === "approved" ? "att-daycard-ok" : ""}`} data-testid="plan-day" data-day={card.day} data-status={p?.status ?? "open"}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-bold text-(--att-text)">{longDay(card.day)}</p>
        {p && <Badge tone={p.status === "approved" ? "green" : p.status === "pending" ? "amber" : "red"}>{p.status === "approved" ? "Approved" : p.status === "pending" ? "Pending" : "Not approved"}</Badge>}
      </div>
      {live ? (
        <>
          <p className="text-sm font-semibold text-(--att-text)">
            Planned {hm12(p.checkIn)} – {hm12(p.checkOut)}
          </p>
          {p.reason && <p className="text-xs att-muted">{p.reason}</p>}
          {p.status === "pending" && (
            <button type="button" className="btn btn-ghost btn-sm mt-2 w-full" disabled={pending} onClick={() => act(() => cancelRequestAction("regularization", p.id))}>
              Withdraw
            </button>
          )}
        </>
      ) : (
        <>
          <p className="text-sm att-muted">{p ? `Not approved${p.remark ? `: “${p.remark}”` : ""}` : "Working day"}</p>
          <button type="button" className="btn btn-primary btn-sm mt-2 w-full" onClick={onOpen}>
            {p ? "Plan again" : "Plan this day"} <ArrowRight size={15} aria-hidden />
          </button>
        </>
      )}
    </article>
  );
}

function PastDialog({ card, approver, onClose }: { card: PastDayCard; approver: string; onClose: () => void }) {
  const { act, pending } = useAct();
  const missed = card.missed;
  const [inTime, setIn] = useState("10:00");
  const [outTime, setOut] = useState("17:30");
  const [reason, setReason] = useState("");
  return (
    <Modal title={`${longDay(card.day)} · ${PAST_CARD_TEXT[card.state].action}`} onClose={onClose}>
      <form
        className="grid gap-4"
        data-testid="reg-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act(() =>
            applyRegularizationAction({ date: card.day, missed, checkIn: missed === "checkout" ? undefined : inTime, checkOut: missed === "checkin" ? undefined : outTime, reason }),
          );
          if (r.ok) onClose();
        }}
      >
        {missed === "checkout" && card.checkIn && <p className="text-sm att-muted">Checked in at {hm12(card.checkIn)}.</p>}
        {missed === "checkin" && card.checkOut && <p className="text-sm att-muted">Checked out at {hm12(card.checkOut)}.</p>}
        <div className="grid justify-items-center gap-4 sm:grid-cols-2">
          {missed !== "checkout" && <TimePicker label="Check-in time" value={inTime} onChange={setIn} testId="pick-in" />}
          {missed !== "checkin" && <TimePicker label="Check-out time" value={outTime} onChange={setOut} testId="pick-out" />}
        </div>
        <label className="flex flex-col gap-1 text-xs font-semibold att-muted">
          Reason
          <textarea className="input" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} />
        </label>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs att-muted">Goes to {approver}. Once approved, the day is corrected.</p>
          <button type="submit" className="btn btn-primary min-h-11 w-full sm:w-auto" disabled={pending}>
            Send request
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PlanDialog({ day, approver, onClose }: { day: string; approver: string; onClose: () => void }) {
  const { act, pending } = useAct();
  const [inTime, setIn] = useState("10:00");
  const [outTime, setOut] = useState("17:30");
  const [reason, setReason] = useState("");
  return (
    <Modal title={`Plan ${longDay(day)}`} onClose={onClose}>
      <form
        className="grid gap-4"
        data-testid="plan-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act(() => applyPlanAction({ date: day, checkIn: inTime, checkOut: outTime, reason }));
          if (r.ok) onClose();
        }}
      >
        <p className="flex items-center gap-1.5 text-sm att-muted">
          <CalendarPlus size={15} aria-hidden /> The hours you plan to work that day.
        </p>
        <div className="grid justify-items-center gap-4 sm:grid-cols-2">
          <TimePicker label="Check-in time" value={inTime} onChange={setIn} testId="pick-in" />
          <TimePicker label="Check-out time" value={outTime} onChange={setOut} testId="pick-out" />
        </div>
        <label className="flex flex-col gap-1 text-xs font-semibold att-muted">
          Note (optional)
          <textarea className="input" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs att-muted">Goes to {approver}. You still check in and out on the day.</p>
          <button type="submit" className="btn btn-primary min-h-11 w-full sm:w-auto" disabled={pending}>
            Submit plan
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── The calendar: tap a date to regularize it (a past day) or plan it (a day ahead) ──

type CalState = "missed" | "sent" | "done" | "plan" | "plan_pending" | "planned" | "plan_rejected" | "none" | "out";

const CAL_TAG: Partial<Record<CalState, string>> = { missed: "Missed", sent: "Sent", done: "Fixed", plan_pending: "Pending", planned: "Planned", plan_rejected: "Rejected" };

function RegCalendar({ past, plans, cal, onOpen }: { past: PastDayCard[]; plans: PlanCard[]; cal: CalendarRange; onOpen: (o: Open) => void }) {
  const pastBy = new Map(past.map((c) => [c.day, c]));
  const planBy = new Map(plans.map((p) => [p.day, p]));
  const first = cal.from.slice(0, 7);
  const last = cal.to.slice(0, 7);
  const [month, setMonth] = useState(cal.today.slice(0, 7));
  const [picked, setPicked] = useState<string | null>(null);

  const stateOf = (day: string): CalState => {
    if (day < cal.from || day > cal.to) return "out";
    const c = pastBy.get(day);
    if (c) return c.state === "pending" ? "sent" : c.state === "regularized" ? "done" : "missed";
    const p = planBy.get(day);
    if (p) return !p.plan ? "plan" : p.plan.status === "pending" ? "plan_pending" : p.plan.status === "approved" ? "planned" : "plan_rejected";
    return "none";
  };
  const tap = (day: string) => {
    const st = stateOf(day);
    setPicked(day);
    if (st === "missed") onOpen({ kind: "past", card: pastBy.get(day)! });
    else if (st === "plan" || st === "plan_rejected") onOpen({ kind: "plan", day });
  };
  const noteOf = (day: string): string => {
    const st = stateOf(day);
    const c = pastBy.get(day);
    const p = planBy.get(day)?.plan;
    const times = (a: string | null | undefined, b: string | null | undefined) => [a && `in ${hm12(a)}`, b && `out ${hm12(b)}`].filter(Boolean).join(", ");
    if (st === "sent") return `Request sent (${times(c?.checkIn, c?.checkOut)}), waiting for approval.`;
    if (st === "done") return `Regularized (${times(c?.checkIn, c?.checkOut)}).`;
    if (st === "missed") return PAST_CARD_TEXT[c!.state].label + ".";
    if (st === "plan_pending" && p) return `Planned ${hm12(p.checkIn)} – ${hm12(p.checkOut)}, waiting for approval.`;
    if (st === "planned" && p) return `Planned ${hm12(p.checkIn)} – ${hm12(p.checkOut)}, approved.`;
    if (st === "plan") return "Working day: tap to plan it.";
    return cal.notes[day] ?? "Outside the days that can be regularized or planned.";
  };

  const { from, to } = monthRange(month);
  const days = eachDay(from, to);
  const lead = (weekday(from) + 6) % 7;
  return (
    <Card
      title="Calendar"
      subtitle="Tap a date: a past day with a missed punch to correct it, a working day ahead to plan it."
      icon={CalendarDays}
      iconTone="green"
      actions={
        <div className="inline-flex items-center gap-1" data-testid="reg-cal-nav">
          <button type="button" className="btn btn-ghost btn-sm att-cal-navbtn" aria-label="Previous month" disabled={month <= first} onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-[8.5rem] text-center text-sm font-bold text-(--att-text)" data-testid="reg-cal-month">
            {formatMonth(month)}
          </span>
          <button type="button" className="btn btn-ghost btn-sm att-cal-navbtn" aria-label="Next month" disabled={month >= last} onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRight size={16} />
          </button>
        </div>
      }
    >
      <div className="att-cal mb-1" aria-hidden>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="text-center text-[0.68rem] font-bold uppercase tracking-wider att-muted">
            {d}
          </div>
        ))}
      </div>
      <div className="att-cal" data-testid="reg-cal">
        {Array.from({ length: lead }, (_, i) => (
          <div key={`lead-${i}`} />
        ))}
        {days.map((d) => {
          const st = stateOf(d);
          const tag = CAL_TAG[st];
          return (
            <button
              key={d}
              type="button"
              disabled={st === "out"}
              onClick={() => tap(d)}
              className={`att-regcal att-regcal-${st}${d === cal.today ? " att-today" : ""}${picked === d ? " is-picked" : ""}`}
              data-day={d}
              data-state={st}
              aria-label={`${longDay(d)}: ${st === "out" ? "not available" : noteOf(d)}`}
            >
              <span className="font-bold">{Number(d.slice(8))}</span>
              {tag && <span className="att-regcal-tag">{tag}</span>}
              {tag && <span className="att-regcal-dot" aria-hidden />}
            </button>
          );
        })}
      </div>
      <p className="mt-3 min-h-[1.25rem] text-sm" data-testid="reg-cal-note" aria-live="polite">
        {picked ? (
          <>
            <span className="font-semibold text-(--att-text)">{longDay(picked)}</span> · <span className="att-muted">{noteOf(picked)}</span>
          </>
        ) : (
          <span className="att-muted">Tap a date to see it or act on it.</span>
        )}
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs att-muted" aria-label="Key">
        <li className="inline-flex items-center gap-1.5"><span className="att-regcal-key att-regcal-missed" /> Missed punch</li>
        <li className="inline-flex items-center gap-1.5"><span className="att-regcal-key att-regcal-sent" /> Sent / fixed</li>
        <li className="inline-flex items-center gap-1.5"><span className="att-regcal-key att-regcal-plan_pending" /> Plan pending</li>
        <li className="inline-flex items-center gap-1.5"><span className="att-regcal-key att-regcal-planned" /> Planned</li>
      </ul>
    </Card>
  );
}
