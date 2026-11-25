"use client";

import { Gift, Home as HomeIcon } from "lucide-react";
import { useState } from "react";
import { applyCompoffAction, applyWfhAction, cancelRequestAction } from "@/lib/attendance/actions/staff";
import { formatDayShort, formatHours } from "@/lib/attendance/time";
import { Card, Empty, Field, RequestStatus } from "../ui";
import { useAct } from "../use-act";

/** The forms and lists under More: work from home and comp-off, and every kind's request list (regularization's cards are in Regularization.tsx). */

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
          <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={pending}>
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
          <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={pending}>
            Claim
          </button>
        </div>
      </form>
    </Card>
  );
}

export type RequestRow = { id: string; when: string; detail: string; status: string; remark: string | null };

/** The person's requests of one kind; pending ones can be withdrawn. Cards on a phone, a table from 768 px. */
export function RequestList({ kind, rows }: { kind: "wfh" | "regularization" | "compoff"; rows: RequestRow[] }) {
  const { act, pending } = useAct();
  if (!rows.length) return <Empty title="No requests yet" />;
  const withdraw = (r: RequestRow) =>
    r.status === "pending" && (
      <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => act(() => cancelRequestAction(kind, r.id))}>
        Withdraw
      </button>
    );
  return (
    <>
      <ul className="divide-y divide-[var(--att-line)] md:hidden">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-1.5 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <p className="font-bold text-(--att-text)">{r.when}</p>
              <RequestStatus status={r.status} />
            </div>
            {r.detail && <p className="text-sm text-gray-700">{r.detail}</p>}
            {r.remark && <p className="text-xs text-gray-500">“{r.remark}”</p>}
            {r.status === "pending" && <div className="flex justify-end">{withdraw(r)}</div>}
          </li>
        ))}
      </ul>
      <div className="att-scroll hidden md:block">
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
                <td className="text-right">{withdraw(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
