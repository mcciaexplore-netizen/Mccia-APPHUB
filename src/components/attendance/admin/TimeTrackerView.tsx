"use client";

import { FolderKanban } from "lucide-react";
import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { decideAction } from "@/lib/attendance/actions/staff";
import { deleteProjectAction, saveProjectAction, timesheetLogsAction } from "@/lib/attendance/actions/admin";
import { addDays, formatDay, formatDayShort, formatHours } from "@/lib/attendance/time";
import { Badge, Card, Empty, Field, RequestStatus } from "../ui";
import { useAct } from "../use-act";

type Sheet = { id: string; userId: string; person: string; weekStartDate: string; status: string; total: number; approver: string; decidedBy: string | null; remark: string | null };
type Project = { id: string; name: string; description: string; isActive: boolean };

/** Every submitted timesheet (open one to see its entries; approve, or reject with a remark), and the projects time is logged against. */
export function TimeTrackerView({ sheets, projects, status }: { sheets: Sheet[]; projects: Project[]; status: string }) {
  const [open, setOpen] = useState<Sheet | null>(null);
  return (
    <div className="flex flex-col gap-5">
      <Card
        title="Timesheets"
        actions={
          <nav className="flex flex-wrap gap-1.5" aria-label="Filter by status">
            {["all", "submitted", "approved", "rejected"].map((s) => (
              <a key={s} href={`/attendance/admin/time${s === "all" ? "" : `?status=${s}`}`} className={`att-badge ${status === s ? "att-tone-primary" : "att-tone-neutral"}`}>
                {s === "all" ? "All" : s[0].toUpperCase() + s.slice(1)}
              </a>
            ))}
          </nav>
        }
        pad={false}
      >
        {sheets.length === 0 ? (
          <Empty title="No timesheets" />
        ) : (
          <div className="att-scroll">
            <table className="att-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Week</th>
                  <th>Hours</th>
                  <th>Status</th>
                  <th>Sent to</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sheets.map((s) => (
                  <tr key={s.id}>
                    <td className="font-semibold">{s.person}</td>
                    <td className="whitespace-nowrap">{formatDay(s.weekStartDate)}</td>
                    <td className="tabular-nums">{formatHours(s.total)}</td>
                    <td>
                      <RequestStatus status={s.status} />
                      {s.remark && <p className="mt-0.5 text-xs att-muted">“{s.remark}”</p>}
                    </td>
                    <td className="text-xs">{s.decidedBy ? `Decided by ${s.decidedBy}` : s.approver}</td>
                    <td className="text-right">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(s)}>
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Projects projects={projects} />
      {open && <SheetDialog sheet={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function SheetDialog({ sheet, onClose }: { sheet: Sheet; onClose: () => void }) {
  const { act, pending } = useAct();
  const [logs, setLogs] = useState<{ date: string; hours: number; description: string; project: string }[] | null>(null);
  const [remark, setRemark] = useState("");
  useEffect(() => {
    let live = true;
    void timesheetLogsAction(sheet.userId, sheet.weekStartDate).then((r) => live && setLogs(r.ok ? r.data : []));
    return () => {
      live = false;
    };
  }, [sheet.userId, sheet.weekStartDate]);
  const decide = async (approve: boolean) => {
    const r = await act(() => decideAction("timesheet", sheet.id, approve, remark).then((x) => (x.ok ? { ...x, message: x.data } : x)));
    if (r.ok) onClose();
  };
  return (
    <Modal title={`${sheet.person} · week of ${formatDay(sheet.weekStartDate)} – ${formatDay(addDays(sheet.weekStartDate, 6))}`} onClose={onClose}>
      {logs == null ? (
        <p className="text-sm att-muted">Loading…</p>
      ) : logs.length === 0 ? (
        <p className="text-sm att-muted">No entries.</p>
      ) : (
        <ul className="max-h-72 divide-y divide-[var(--att-line)] overflow-y-auto text-sm">
          {logs.map((l, i) => (
            <li key={i} className="flex gap-2 py-1.5">
              <span className="w-24 shrink-0 font-semibold">{formatDayShort(l.date)}</span>
              <span className="flex-1">
                {l.project} <span className="att-muted">{l.description}</span>
              </span>
              <span className="tabular-nums">{formatHours(l.hours)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-sm font-semibold">Total {formatHours(sheet.total)}</p>
      {sheet.status === "submitted" && (
        <>
          <label className="mt-3 flex flex-col gap-1 text-xs font-semibold att-muted">
            Remark (required to reject)
            <textarea className="input" rows={2} value={remark} maxLength={1000} onChange={(e) => setRemark(e.target.value)} />
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn btn-danger btn-sm" disabled={pending || remark.trim().length < 2} onClick={() => decide(false)}>
              Reject
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={pending} onClick={() => decide(true)}>
              Approve
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function Projects({ projects }: { projects: Project[] }) {
  const { act, pending } = useAct();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  return (
    <Card title="Projects" icon={FolderKanban} iconTone="purple" pad={false}>
      <form
        className="grid gap-2 border-b border-[var(--att-line)] px-5 py-4 sm:grid-cols-[1fr_2fr_auto] sm:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await act(() => saveProjectAction({ name, description, isActive: true }));
          if (r.ok) {
            setName("");
            setDescription("");
          }
        }}
      >
        <Field label="New project">
          <input className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Description">
          <input className="input" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          Add
        </button>
      </form>
      {projects.length === 0 ? (
        <p className="px-5 py-4 text-sm att-muted">No projects yet: staff need at least one to log time.</p>
      ) : (
        <ul className="divide-y divide-[var(--att-line)]">
          {projects.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-sm">
              <span className="flex-1">
                <span className="font-semibold">{p.name}</span> {p.description && <span className="att-muted">· {p.description}</span>}
              </span>
              {!p.isActive && <Badge>Closed</Badge>}
              <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => act(() => saveProjectAction({ id: p.id, name: p.name, description: p.description, isActive: !p.isActive }))}>
                {p.isActive ? "Close" : "Reopen"}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm text-[var(--att-red)]"
                disabled={pending}
                onClick={() => act(() => deleteProjectAction(p.id).then((r) => (r.ok ? { ...r, message: r.data === "deleted" ? "Project deleted" : "It has time logged, so it was closed instead" } : r)))}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
