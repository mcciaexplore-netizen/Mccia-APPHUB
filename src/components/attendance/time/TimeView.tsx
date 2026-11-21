"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { TimesheetStatus } from "@/db/attendance-schema";
import { addTimeAction, deleteTimeAction, submitWeekAction } from "@/lib/attendance/actions/staff";
import { canEditWeek, weekDays } from "@/lib/attendance/timesheet";
import { formatDayShort, formatHours } from "@/lib/attendance/time";
import { Card, Empty, Field, RequestStatus } from "../ui";
import { useAct } from "../use-act";

type Log = { id: string; projectName: string; date: string; hours: number; description: string };

/** One week's time: entries by day, a form to log more, and Submit. A submitted week is locked until it is rejected. */
export function TimeView({ week, today, projects, logs, status, remark, total }: { week: string; today: string; projects: { id: string; name: string }[]; logs: Log[]; status: TimesheetStatus | null; remark: string | null; total: number }) {
  const { act, pending } = useAct();
  const editable = canEditWeek(status);
  const days = weekDays(week);
  const [date, setDate] = useState(days.includes(today) ? today : days[0]);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [hours, setHours] = useState("1");
  const [description, setDescription] = useState("");

  return (
    <div className="flex flex-col gap-5">
      <Card
        title={
          <span className="flex items-center gap-2">
            Week total: {formatHours(total)} {status && <RequestStatus status={status} />}
          </span>
        }
        actions={
          editable && (
            <button type="button" className="btn btn-primary btn-sm" disabled={pending || total <= 0 || week > today} onClick={() => act(() => submitWeekAction(week))}>
              {status === "rejected" ? "Resubmit week" : "Submit week for approval"}
            </button>
          )
        }
        pad={false}
      >
        {remark && <p className="border-b border-[var(--att-line)] bg-[var(--att-amber-tint)] px-5 py-2 text-sm">Remark: {remark}</p>}
        {!editable && <p className="border-b border-[var(--att-line)] px-5 py-2 text-xs att-muted">This week is {status} and locked{status === "submitted" ? " until it is approved or rejected" : ""}.</p>}
        <ul className="divide-y divide-[var(--att-line)]">
          {days.map((d) => {
            const dayLogs = logs.filter((l) => l.date === d);
            const sum = dayLogs.reduce((n, l) => n + l.hours, 0);
            return (
              <li key={d} className="px-5 py-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className={`font-semibold ${d === today ? "text-[var(--att-primary)]" : "text-ink"}`}>{formatDayShort(d)}</span>
                  <span className="tabular-nums att-muted">{sum ? formatHours(sum) : "—"}</span>
                </div>
                {dayLogs.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-1">
                    {dayLogs.map((l) => (
                      <li key={l.id} className="flex items-center gap-2 rounded-md bg-[var(--att-grey-tint)] px-2.5 py-1.5 text-sm">
                        <span className="font-semibold">{l.projectName}</span>
                        <span className="flex-1 truncate att-muted">{l.description}</span>
                        <span className="tabular-nums">{formatHours(l.hours)}</span>
                        {editable && (
                          <button type="button" aria-label="Remove entry" className="att-muted hover:text-[var(--att-red)]" disabled={pending} onClick={() => act(() => deleteTimeAction(l.id))}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {editable && (
        <Card title="Log time" icon={Plus} iconTone="green">
          {projects.length === 0 ? (
            <Empty title="No projects yet">HR adds the projects time is logged against in Attendance Admin → Time Tracker.</Empty>
          ) : (
            <form
              className="grid gap-3 sm:grid-cols-[1fr_1fr_6rem] lg:grid-cols-[1fr_1fr_6rem_2fr_auto] lg:items-end"
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await act(() => addTimeAction({ projectId, date, hours: Number(hours), description }));
                if (r.ok) setDescription("");
              }}
            >
              <Field label="Project">
                <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Day">
                <select className="input" value={date} onChange={(e) => setDate(e.target.value)}>
                  {days
                    .filter((d) => d <= today)
                    .map((d) => (
                      <option key={d} value={d}>
                        {formatDayShort(d)}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Hours">
                <input className="input" type="number" min={0.25} max={24} step={0.25} value={hours} onChange={(e) => setHours(e.target.value)} required />
              </Field>
              <Field label="What you did">
                <input className="input" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
              <button type="submit" className="btn btn-primary" disabled={pending || week > today}>
                Add
              </button>
            </form>
          )}
        </Card>
      )}
    </div>
  );
}
