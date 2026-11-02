"use client";

import { useEffect, useState } from "react";
import { Play, Square, Trash2 } from "lucide-react";
import type { TicketDetail } from "@/lib/design/detail";
import { deleteTimeAction, logTimeAction, startTimerAction, stopTimerAction, updateTicketAction } from "@/lib/design/actions/tickets";
import { istDate } from "@/lib/design/rules";
import { Card, formatDateTime } from "../ui";
import { useAct } from "./use-act";
import type { Viewer } from "./ticket-view";

export const hm = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};
const clock = (seconds: number) => [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60].map((n) => String(n).padStart(2, "0")).join(":");

/** Start/stop timer (one running at a time per person), time logged by hand, the estimate and every entry. */
export function TimeTracker({ d, viewer, editable }: { d: TicketDetail; viewer: Viewer; editable: boolean }) {
  const { act, pending } = useAct();
  const runningHere = d.running?.ticketId === d.card.id ? d.running : null;
  const runningElsewhere = d.running && !runningHere;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!runningHere) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [runningHere]);
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const [day, setDay] = useState(istDate());
  const [estimate, setEstimate] = useState(d.estimateHours?.toString() ?? "");
  const elapsed = runningHere ? Math.max(0, Math.floor((now - +new Date(runningHere.startedAt)) / 1000)) : 0;

  return (
    <Card title="Time" actions={<span className="text-sm font-semibold text-ink">{hm(d.timeSpentSeconds)} logged</span>}>
      <div className="flex flex-wrap items-center gap-3">
        {runningHere ? (
          <>
            <span className="font-mono text-2xl font-bold tabular-nums text-[var(--ds-navy)]" aria-live="off" suppressHydrationWarning>
              {clock(elapsed)}
            </span>
            <button type="button" className="btn btn-sm ds-btn-outline-red" disabled={pending} onClick={() => act(() => stopTimerAction(), { quiet: true })}>
              <Square size={14} /> Stop
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-sm ds-btn-green" disabled={pending || !editable} onClick={() => act(() => startTimerAction(d.card.id), { quiet: true })}>
            <Play size={14} /> Start timer
          </button>
        )}
      </div>
      {runningElsewhere && <p className="mt-2 text-xs ds-muted">Your timer is running on another ticket; starting here stops it.</p>}

      {editable && (
        <form
          className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-[6rem_minmax(0,1fr)_9rem_auto]"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await act(() => logTimeAction(d.card.id, Number(minutes), note, day));
            if (r.ok) {
              setMinutes("");
              setNote("");
            }
          }}
        >
          <input className="input" type="number" min={1} max={960} placeholder="Minutes" aria-label="Minutes" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          <input className="input" placeholder="Note (optional)" aria-label="Note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          <input className="input" type="date" aria-label="Day" value={day} max={istDate()} onChange={(e) => setDay(e.target.value)} />
          <button className="btn btn-sm ds-btn-navy" disabled={pending || !(Number(minutes) > 0)}>
            Log
          </button>
        </form>
      )}

      <label className="ds-label mt-4 flex items-center gap-2">
        Estimate (hours)
        <input
          className="input w-24"
          type="number"
          min={0.5}
          step={0.5}
          value={estimate}
          disabled={!editable || pending}
          onChange={(e) => setEstimate(e.target.value)}
          onBlur={() => {
            const v = estimate === "" ? null : Number(estimate);
            if (v !== d.estimateHours) act(() => updateTicketAction(d.card.id, { estimateHours: v }));
          }}
        />
      </label>

      {d.time.length > 0 && (
        <ul className="mt-4 flex flex-col divide-y divide-[var(--ds-line)] text-sm">
          {d.time.map((e) => (
            <li key={e.id} className="flex items-center gap-2 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="font-medium text-ink">{e.endedAt ? hm(e.seconds) : "Running"}</span>
                <span className="ds-muted">
                  {" "}
                  · {e.user ?? "Unknown"} · {formatDateTime(e.startedAt)}
                  {e.source === "manual" ? " · logged" : ""}
                </span>
                {e.note && <span className="block text-xs ds-muted">{e.note}</span>}
              </span>
              {e.endedAt && (viewer.lead || e.userId === viewer.id) && (
                <button type="button" aria-label="Delete entry" className="rounded p-1 text-subtle hover:text-[var(--ds-red)]" onClick={() => act(() => deleteTimeAction(e.id), { quiet: true })}>
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
