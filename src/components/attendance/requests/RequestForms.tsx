"use client";

import { Clock, Gift, Home as HomeIcon } from "lucide-react";
import { useState } from "react";
import type { MissedPunch } from "@/db/attendance-schema";
import { applyCompoffAction, applyRegularizationAction, applyWfhAction, cancelRequestAction } from "@/lib/attendance/actions/staff";
import { formatDayShort, formatHours } from "@/lib/attendance/time";
import { Card, Empty, Field, RequestStatus } from "../ui";
import { useAct } from "../use-act";

/** The forms and lists under More: work from home, regularization and comp-off. */

export function WfhForm({ today, approver }: { today: string; approver: string }) {
  const { act, pending } = useAct();
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState("");
  const [plan, setPlan] = useState("");
  return (
    <Card title="Ask to work from home" icon={HomeIcon} iconTone="green">
      <form
        className="grid gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act(() => applyWfhAction({ date, reason, planNote: plan }));
          if (r.ok) {
            setReason("");
            setPlan("");
          }
        }}
      >
        <Field label="Day">
          <input type="date" className="input max-w-xs" min={today} value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Reason">
          <textarea className="input" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} required />
        </Field>
        <Field label="What you plan to work on (optional)">
          <textarea className="input" rows={2} maxLength={1000} value={plan} onChange={(e) => setPlan(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs att-muted">Goes to {approver}. Once approved, you can check in from anywhere that day.</p>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            Send request
          </button>
        </div>
      </form>
    </Card>
  );
}

export function RegularizationForm({ days, approver, windowDays }: { days: { day: string; missed: MissedPunch[]; checkIn: string | null }[]; approver: string; windowDays: number }) {
  const { act, pending } = useAct();
  const [day, setDay] = useState(days[0]?.day ?? "");
  const d = days.find((x) => x.day === day);
  const missed = d?.missed[0] ?? "both";
  const [inTime, setIn] = useState("10:00");
  const [outTime, setOut] = useState("17:30");
  const [reason, setReason] = useState("");
  if (!days.length) return <Card title="Correct a missed punch" icon={Clock} iconTone="orange"><Empty title="Nothing to correct">In the last {windowDays} days there is no working day with a missed check-in or check-out (or a request is already in for it).</Empty></Card>;
  return (
    <Card title="Correct a missed punch" icon={Clock} iconTone="orange">
      <form
        className="grid gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act(() => applyRegularizationAction({ date: day, missed, checkIn: missed === "checkout" ? undefined : inTime, checkOut: outTime, reason }));
          if (r.ok) setReason("");
        }}
      >
        <Field label="Day" hint={`Only days in the last ${windowDays} days with a genuinely missed punch are listed.`}>
          <select className="input max-w-sm" value={day} onChange={(e) => setDay(e.target.value)}>
            {days.map((x) => (
              <option key={x.day} value={x.day}>
                {formatDayShort(x.day)} · {x.missed[0] === "checkout" ? `missed check-out (in at ${x.checkIn})` : "no check-in or check-out"}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid max-w-sm grid-cols-2 gap-3">
          {missed !== "checkout" ? (
            <Field label="Check-in time">
              <input type="time" className="input" value={inTime} onChange={(e) => setIn(e.target.value)} required />
            </Field>
          ) : (
            <Field label="Check-in (recorded)">
              <input className="input" value={d?.checkIn ?? ""} disabled />
            </Field>
          )}
          <Field label="Check-out time">
            <input type="time" className="input" value={outTime} onChange={(e) => setOut(e.target.value)} required />
          </Field>
        </div>
        <Field label="Reason">
          <textarea className="input" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} required />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs att-muted">Goes to {approver}. Once approved, the day is corrected.</p>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            Send request
          </button>
        </div>
      </form>
    </Card>
  );
}

export function CompoffForm({ days, approver, expiryDays }: { days: { day: string; hours: number }[]; approver: string; expiryDays: number }) {
  const { act, pending } = useAct();
  const [day, setDay] = useState(days[0]?.day ?? "");
  const [type, setType] = useState<"full" | "half">("full");
  const [reason, setReason] = useState("");
  if (!days.length)
    return (
      <Card title="Claim a comp-off" icon={Gift} iconTone="purple">
        <Empty title="Nothing to claim">Check in and out on a holiday or weekly off (extra work) and the day appears here. Comp-offs expire {expiryDays} days after the day worked.</Empty>
      </Card>
    );
  return (
    <Card title="Claim a comp-off" icon={Gift} iconTone="purple">
      <form
        className="grid gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act(() => applyCompoffAction({ workedDate: day, type, reason }));
          if (r.ok) setReason("");
        }}
      >
        <Field label="Day worked">
          <select className="input max-w-sm" value={day} onChange={(e) => setDay(e.target.value)}>
            {days.map((x) => (
              <option key={x.day} value={x.day}>
                {formatDayShort(x.day)} · {formatHours(x.hours)} worked
              </option>
            ))}
          </select>
        </Field>
        <fieldset className="flex gap-4 text-sm">
          <legend className="mb-1 text-xs font-semibold att-muted">Comp-off</legend>
          {(["full", "half"] as const).map((t) => (
            <label key={t} className="inline-flex items-center gap-1.5">
              <input type="radio" name="type" checked={type === t} onChange={() => setType(t)} /> {t === "full" ? "Full day" : "Half day"}
            </label>
          ))}
        </fieldset>
        <Field label="Note (optional)">
          <input className="input" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs att-muted">Goes to {approver}. Expires {expiryDays} days after the day worked.</p>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            Claim
          </button>
        </div>
      </form>
    </Card>
  );
}

export type RequestRow = { id: string; when: string; detail: string; status: string; remark: string | null };

/** The person's requests of one kind; pending ones can be withdrawn. */
export function RequestList({ kind, rows }: { kind: "wfh" | "regularization" | "compoff"; rows: RequestRow[] }) {
  const { act, pending } = useAct();
  if (!rows.length) return <Empty title="No requests yet" />;
  return (
    <div className="att-scroll">
      <table className="att-table">
        <thead>
          <tr>
            <th>Day</th>
            <th>Details</th>
            <th>Status</th>
            <th>Remark</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap font-semibold">{r.when}</td>
              <td className="text-sm">{r.detail}</td>
              <td>
                <RequestStatus status={r.status} />
              </td>
              <td className="text-xs att-muted">{r.remark ?? ""}</td>
              <td className="text-right">
                {r.status === "pending" && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => act(() => cancelRequestAction(kind, r.id))}>
                    Withdraw
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
