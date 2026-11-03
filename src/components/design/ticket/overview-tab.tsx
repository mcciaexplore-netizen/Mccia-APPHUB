"use client";

import { useState } from "react";
import { Download, ExternalLink, Trash2 } from "lucide-react";
import type { TicketDetail } from "@/lib/design/detail";
import { addAttachmentsAction, clientChangeAction, removeAttachmentAction, setSubtaskAction, subtaskAction } from "@/lib/design/actions/tickets";
import { MAX_FILE_MB, MAX_FILES } from "@/lib/design/form";
import { formatBytes } from "@/lib/design/file-types";
import { Badge, Card, formatDateTime, formatDay } from "../ui";
import { FileDrop } from "../file-drop";
import { fileHref } from "../upload";
import { useAct } from "./use-act";
import { TimeTracker } from "./time-tracker";
import { AuditLog } from "./audit-log";
import type { Viewer } from "./ticket-view";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="ds-label">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  );
}

/** Tab 1: the request itself, the checklist, the requester's changes, files, time and history. */
export function OverviewTab({ d, viewer, editable }: { d: TicketDetail; viewer: Viewer; editable: boolean }) {
  const t = d.card;
  const { act, pending } = useAct();
  const [sub, setSub] = useState("");
  const [change, setChange] = useState("");
  const [newFiles, setNewFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [dropKey, setDropKey] = useState(0);
  const done = d.subtasks.filter((s) => s.done).length;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-5">
        <Card title="Brief">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{d.brief}</p>
          {d.content && (
            <div className="mt-4 rounded-lg border border-[var(--ds-line)] bg-[#fafafa] px-3 py-2 text-sm">
              <span className="ds-label block">Content for the design</span>
              <span className="whitespace-pre-wrap text-ink">{d.content}</span>
            </div>
          )}
          {d.reasonForChange && (
            <div className="mt-4 rounded-lg border border-[rgba(217,119,6,0.25)] bg-[var(--ds-amber-tint)] px-3 py-2 text-sm">
              <span className="ds-label block">Changes asked for (version {t.versionNumber})</span>
              <span className="whitespace-pre-wrap text-ink">{d.reasonForChange}</span>
            </div>
          )}
          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <Fact label="Requested by">
              {t.requesterName ?? "Unknown"}
              {d.requesterEmail && <span className="block text-xs ds-muted">{d.requesterEmail}</span>}
            </Fact>
            <Fact label="Department">{t.department ?? "–"}</Fact>
            <Fact label="Event">{d.eventName ?? "–"}{t.eventDate && <span className="block text-xs ds-muted">{formatDay(t.eventDate)}</span>}</Fact>
            <Fact label="Needed by">{t.deliveryDate ? formatDay(t.deliveryDate) : "–"}</Fact>
            <Fact label="Requested on">{formatDateTime(t.createdAt)}</Fact>
            {d.editWindowEndsAt && <Fact label="Edit window ends">{formatDateTime(d.editWindowEndsAt)}</Fact>}
          </dl>
          {t.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1">
              {t.tags.map((x) => (
                <Badge key={x} tone={x === "Extra revision" || x === "Last-Minute Change" ? "red" : "neutral"}>
                  {x}
                </Badge>
              ))}
            </div>
          )}
        </Card>

        <Card title="Designs requested">
          <ul className="flex flex-col gap-3">
            {d.answers.map((a) => (
              <li key={a.design} className="rounded-lg border border-[var(--ds-line)] px-3 py-2.5">
                <Badge tone="blue">{a.design}</Badge>
                {a.lines.length > 0 && (
                  <ul className="mt-1.5 text-sm text-ink">
                    {a.lines.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          {d.referenceLinks.length > 0 && (
            <div className="mt-4">
              <p className="ds-label mb-1">Reference links</p>
              <ul className="flex flex-col gap-1 text-sm">
                {d.referenceLinks.map((l) => (
                  <li key={l}>
                    <a href={l} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all text-[var(--ds-navy)] hover:underline">
                      {l} <ExternalLink size={12} />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card title={`Subtasks (${done}/${d.subtasks.length})`}>
          {d.subtasks.length === 0 && <p className="text-sm ds-muted">No subtasks yet.</p>}
          <ul className="flex flex-col gap-1.5">
            {d.subtasks.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" id={`st-${s.id}`} checked={s.done} disabled={!editable || pending} onChange={(e) => act(() => setSubtaskAction(s.id, e.target.checked), { quiet: true })} className="h-4 w-4 accent-[#003F8A]" />
                <label htmlFor={`st-${s.id}`} className={`flex-1 ${s.done ? "line-through ds-muted" : "text-ink"}`}>
                  {s.title}
                </label>
                {editable && (
                  <button type="button" aria-label={`Delete subtask ${s.title}`} className="rounded p-1 text-subtle hover:text-[var(--ds-red)]" onClick={() => act(() => setSubtaskAction(s.id, null), { quiet: true })}>
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {editable && (
            <form
              className="mt-3 flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await act(() => subtaskAction(t.id, sub), { quiet: true });
                if (r.ok) setSub("");
              }}
            >
              <input className="input flex-1" placeholder="Add a subtask" aria-label="New subtask" value={sub} maxLength={200} onChange={(e) => setSub(e.target.value)} />
              <button className="btn btn-sm ds-btn-navy" disabled={pending || !sub.trim()}>
                Add
              </button>
            </form>
          )}
        </Card>

        <Card title="Changes from the requester">
          <p className="mb-3 text-xs ds-muted">What the requester asked for outside the app (a call, an email, a meeting), written down so the designer works from it.</p>
          {d.clientChanges.length === 0 ? (
            <p className="text-sm ds-muted">None noted.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {d.clientChanges.map((c, i) => (
                <li key={i} className="rounded-lg bg-[var(--ds-grey-tint)] px-3 py-2 text-sm">
                  <p className="whitespace-pre-wrap text-ink">{c.text}</p>
                  <p className="mt-1 text-xs ds-muted">
                    {c.by} · {formatDateTime(c.at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {editable && (
            <form
              className="mt-3 flex flex-col gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await act(() => clientChangeAction(t.id, change));
                if (r.ok) setChange("");
              }}
            >
              <textarea className="input min-h-20" placeholder="What does the requester want changed?" aria-label="Requester's change" value={change} maxLength={2000} onChange={(e) => setChange(e.target.value)} />
              <button className="btn btn-sm ds-btn-navy self-end" disabled={pending || !change.trim()}>
                Note it
              </button>
            </form>
          )}
        </Card>
      </div>

      <div className="flex flex-col gap-5">
        <Card title={`Files (${d.attachments.length})`}>
          {d.attachments.length === 0 && <p className="text-sm ds-muted">No files attached.</p>}
          <ul className="flex flex-col gap-2">
            {d.attachments.map((a) => (
              <li key={a.id} className="flex items-center gap-2 rounded-lg border border-[var(--ds-line)] px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <a href={fileHref(a.fileId)} className="block truncate font-medium text-[var(--ds-navy)] hover:underline">
                    {a.fileName}
                  </a>
                  <span className="text-xs ds-muted">
                    {formatBytes(a.size)} · {a.uploadedBy ?? "Unknown"}
                  </span>
                </span>
                <a href={fileHref(a.fileId)} aria-label={`Download ${a.fileName}`} className="rounded p-1 text-subtle hover:text-ink">
                  <Download size={15} />
                </a>
                {editable && (viewer.lead || a.uploadedById === viewer.id) && (
                  <button type="button" aria-label={`Remove ${a.fileName}`} className="rounded p-1 text-subtle hover:text-[var(--ds-red)]" disabled={pending} onClick={() => act(() => removeAttachmentAction(a.id))}>
                    <Trash2 size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {editable && (
            <div className="mt-4">
              <FileDrop key={dropKey} purpose="attachment" maxFiles={MAX_FILES} maxMb={MAX_FILE_MB} onChange={setNewFiles} onBusy={setBusy} label="Add files" />
              {newFiles.length > 0 && (
                <button
                  type="button"
                  className="btn btn-sm ds-btn-navy mt-3 w-full"
                  disabled={pending || busy}
                  onClick={async () => {
                    const r = await act(() => addAttachmentsAction(t.id, newFiles));
                    if (r.ok) {
                      setNewFiles([]);
                      setDropKey((k) => k + 1);
                    }
                  }}
                >
                  Attach {newFiles.length} file{newFiles.length === 1 ? "" : "s"}
                </button>
              )}
            </div>
          )}
        </Card>
        <TimeTracker d={d} viewer={viewer} editable={editable} />
      </div>

      <div className="xl:col-span-2">
        <AuditLog items={d.audit} />
      </div>
    </div>
  );
}
