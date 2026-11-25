"use client";

import { AlertTriangle, ArrowRight, CalendarClock, CalendarPlus, CheckCircle2, Clock, Hourglass } from "lucide-react";
import { useState } from "react";
import { Modal } from "@/components/Modal";
import { applyPlanAction, applyRegularizationAction, cancelRequestAction } from "@/lib/attendance/actions/staff";
import { PAST_CARD_TEXT } from "@/lib/attendance/regularization";
import type { PastDayCard, PlanCard } from "@/lib/attendance/requests";
import { formatDay, weekdayName } from "@/lib/attendance/time";
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

export function RegularizationView({ past, plans, approver, windowDays, aheadDays }: { past: PastDayCard[]; plans: PlanCard[]; approver: string; windowDays: number; aheadDays: number }) {
  const [open, setOpen] = useState<Open>(null);
  return (
    <>
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
