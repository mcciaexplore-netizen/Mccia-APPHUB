"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import type { Priority, RequestStatus } from "@/db/aistudio-schema";
import { deleteAction, deliverAction, deliverablesAction, noteAction, removeDeliverableAction, updateAction } from "@/lib/aistudio/actions/admin";
import { MAX_DELIVERABLE_MB, PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL, TYPE_LABEL, canMove } from "@/lib/aistudio/aistudio.manifest";
import type { AdminDetail } from "@/lib/aistudio/queries";
import { formatBytes } from "@/lib/aistudio/file-types";
import { FileDrop } from "../file-drop";
import { FilesList, LinksList, Timeline } from "../files-list";
import { useAct } from "../use-act";
import { Card, PriorityBadge, StatusBadge, TypeBadge, fileHref, formatDateTime, formatDay } from "../ui";
import { PendingActions } from "./PendingList";

type Viewer = { lead: boolean };

/** One line of history: "accepted → in_progress" for a change, the value otherwise. */
const change = (v: unknown): string => {
  if (v && typeof v === "object" && "to" in v) {
    const c = v as { from?: unknown; to?: unknown };
    return `${String(c.from ?? "–")} → ${String(c.to ?? "–")}`;
  }
  return Array.isArray(v) ? v.join(", ") : String(v);
};
type Tab = "overview" | "notes" | "deliverables";

/** Status, assignee, deadline and priority at the top: the team moves it along (see canMove) and sets deadline and priority; leads assign. */
function Controls({ d, viewer }: { d: AdminDetail; viewer: Viewer }) {
  const { act, pending } = useAct();
  const t = d.card;
  const role = viewer.lead ? "lead" : "member";
  const [status, setStatus] = useState<RequestStatus>(t.status);
  const [assignee, setAssignee] = useState(t.assigneeId ?? "");
  const [deadline, setDeadline] = useState(t.deadline ?? "");
  const [priority, setPriority] = useState<Priority | "">(t.priority ?? "");
  const options = STATUSES.filter((s) => s === t.status || canMove(role, t.status, s));
  const changed = status !== t.status || assignee !== (t.assigneeId ?? "") || deadline !== (t.deadline ?? "") || priority !== (t.priority ?? "");
  return (
    <form
      className="ai-card flex flex-wrap items-end gap-3 px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        void act(() =>
          updateAction(t.id, {
            ...(status !== t.status ? { status } : {}),
            ...(viewer.lead && assignee !== (t.assigneeId ?? "") ? { assigneeId: assignee || null } : {}),
            ...(deadline !== (t.deadline ?? "") ? { deadline: deadline || null } : {}),
            ...(priority !== (t.priority ?? "") ? { priority: (priority || null) as Priority | null } : {}),
          }),
        );
      }}
    >
      <label className="ai-label flex flex-col gap-1">
        Status
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value as RequestStatus)} disabled={options.length < 2}>
          {options.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="ai-label flex flex-col gap-1">
        Assigned to
        <select className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={!viewer.lead}>
          <option value="">Not assigned</option>
          {d.team.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          {t.assigneeId && !d.team.some((p) => p.id === t.assigneeId) && <option value={t.assigneeId}>{t.assigneeName}</option>}
        </select>
      </label>
      <label className="ai-label flex flex-col gap-1">
        Deadline
        <input className="input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
      </label>
      <label className="ai-label flex flex-col gap-1">
        Priority
        <select className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority | "")}>
          <option value="">Not set</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>
      </label>
      <button className="btn btn-sm ai-btn-navy" disabled={pending || !changed}>
        Save changes
      </button>
    </form>
  );
}

function Overview({ d }: { d: AdminDetail }) {
  const t = d.card;
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-5">
        <Card title="Request">
          <dl className="mb-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="ai-label">Type</dt>
              <dd>{TYPE_LABEL[t.requestType]}</dd>
            </div>
            <div>
              <dt className="ai-label">Department</dt>
              <dd>{t.department ?? "–"}</dd>
            </div>
            <div>
              <dt className="ai-label">Requested by</dt>
              <dd>
                {t.requesterName ?? "–"}
                {d.requesterEmail && <span className="block text-xs ai-muted">{d.requesterEmail}</span>}
              </dd>
            </div>
            <div>
              <dt className="ai-label">Submitted</dt>
              <dd suppressHydrationWarning>{formatDateTime(t.createdAt)}</dd>
            </div>
            <div>
              <dt className="ai-label">Assigned to</dt>
              <dd>{t.assigneeName ?? "Not assigned"}</dd>
            </div>
            <div>
              <dt className="ai-label">Deadline · Priority</dt>
              <dd className="flex items-center gap-2">
                {t.deadline ? formatDay(t.deadline) : "Not set"} <PriorityBadge priority={t.priority} />
              </dd>
            </div>
          </dl>
          <p className="ai-label">Description</p>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{d.description}</p>
          {d.content && (
            <div className="mt-4 rounded-lg border border-[var(--ai-line)] bg-[#fafafa] px-3 py-2 text-sm">
              <span className="ai-label block">Content shared by the requester</span>
              <span className="whitespace-pre-wrap text-ink">{d.content}</span>
            </div>
          )}
          {d.declineReason && <p className="mt-4 text-sm text-[var(--ai-red)]">Declined: {d.declineReason}</p>}
        </Card>
        <Card title="References">
          <p className="ai-label mb-2">Links</p>
          <LinksList links={d.referenceLinks} />
          <p className="ai-label mb-2 mt-4">Files</p>
          <FilesList files={d.attachments} />
        </Card>
      </div>
      <div className="flex flex-col gap-5">
        <Card title="Progress">
          <Timeline steps={d.steps} />
        </Card>
        <Card title="History">
          <ol className="flex flex-col gap-3">
            {d.audit.map((a) => (
              <li key={a.id} className="border-l-2 border-[var(--ai-navy-line)] pl-3 text-sm">
                <p className="text-ink">
                  <strong>{a.action}</strong>{" "}
                  <span className="ai-muted" suppressHydrationWarning>
                    · {a.who} · {formatDateTime(a.at)}
                  </span>
                </p>
                {Object.entries(a.details)
                  .filter(([, v]) => v !== null && v !== undefined && v !== "")
                  .map(([k, v]) => (
                    <p key={k} className="break-words text-xs ai-muted">
                      {k.replace(/_/g, " ")}: {change(v)}
                    </p>
                  ))}
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}

function Notes({ d }: { d: AdminDetail }) {
  const { act, pending } = useAct();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(true);
  return (
    <div className="flex flex-col gap-5">
      <Card title="Add a note">
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await act(() => noteAction(d.card.id, body, internal));
            if (r.ok) setBody("");
          }}
        >
          <textarea className="input min-h-24" aria-label="Note" maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What happened, what is next, a question for the team..." />
          <div className="ai-tabs self-start" role="tablist" aria-label="Who sees it">
            <button type="button" role="tab" aria-selected={internal} className="ai-tab" onClick={() => setInternal(true)}>
              Internal only
            </button>
            <button type="button" role="tab" aria-selected={!internal} className="ai-tab" onClick={() => setInternal(false)}>
              Share with requester
            </button>
          </div>
          <p className="text-xs ai-muted">{internal ? "Only the AI Studio team sees it." : "The requester sees it on their request (signed “AI Studio team”) and is told by email."}</p>
          <button className="btn btn-sm ai-btn-navy self-start" disabled={pending || !body.trim()}>
            Add note
          </button>
        </form>
      </Card>
      <Card title="Notes">
        {d.notes.length === 0 ? (
          <p className="text-sm ai-muted">No notes yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {d.notes.map((n) => (
              <li key={n.id} className="border-l-2 border-[var(--ai-navy-line)] pl-3 text-sm">
                <p className="flex flex-wrap items-center gap-2 text-xs ai-muted" suppressHydrationWarning>
                  <span className={`ai-badge ${n.internal ? "ai-tone-neutral" : "ai-tone-green"}`}>{n.internal ? "Internal" : "Shared with requester"}</span>
                  {n.by ?? "Someone"} · {formatDateTime(n.at)}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-ink">{n.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Deliverables({ d, viewer }: { d: AdminDetail; viewer: Viewer }) {
  const { act, pending } = useAct();
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [dropKey, setDropKey] = useState(0);
  const [notesText, setNotesText] = useState(d.deliveryNotes ?? "");
  const t = d.card;
  const open = t.status !== "pending_review" && t.status !== "declined";
  const deliveredAlready = t.status === "delivered" || t.status === "closed";
  const canDeliver = canMove(viewer.lead ? "lead" : "member", t.status, "delivered");
  return (
    <div className="flex flex-col gap-5">
      {open && !deliveredAlready && (
        <Card title="Upload deliverables for requester">
          <FileDrop key={dropKey} purpose="deliverable" maxFiles={10} maxMb={MAX_DELIVERABLE_MB} onChange={setFileIds} onBusy={setBusy} hint={`Any file type · up to ${MAX_DELIVERABLE_MB} MB each`} />
          <button
            type="button"
            className="btn btn-sm ai-btn-navy mt-3"
            disabled={pending || busy || !fileIds.length}
            onClick={async () => {
              const r = await act(() => deliverablesAction(t.id, fileIds));
              if (r.ok) {
                setFileIds([]);
                setDropKey((k) => k + 1);
              }
            }}
          >
            Upload {fileIds.length > 1 ? `${fileIds.length} files` : ""}
          </button>
        </Card>
      )}
      <Card title="Deliverables">
        {d.deliverables.length === 0 ? (
          <p className="text-sm ai-muted">{open ? "Nothing uploaded yet." : "Accept the request first."}</p>
        ) : (
          <ul className="divide-y divide-[var(--ai-line)] rounded-lg border border-[var(--ai-line)]">
            {d.deliverables.map((f) => (
              <li key={f.attachmentId} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <a href={fileHref(f.fileId)} className="block truncate font-medium text-[var(--ai-navy)] hover:underline">
                    {f.fileName}
                  </a>
                  <span className="block text-xs ai-muted" suppressHydrationWarning>
                    {formatBytes(f.size)} · {f.by ?? "Unknown"} · {formatDateTime(f.at)}
                  </span>
                </span>
                {!deliveredAlready && (
                  <button type="button" className="btn btn-ghost btn-sm text-[var(--ai-red)]" aria-label={`Remove ${f.fileName}`} disabled={pending} onClick={() => act(() => removeDeliverableAction(f.attachmentId))}>
                    <Trash2 size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {deliveredAlready && d.deliveryNotes && <p className="mt-3 whitespace-pre-wrap text-sm text-ink">{d.deliveryNotes}</p>}
      </Card>
      {canDeliver && !deliveredAlready && (
        <Card title="Mark as Delivered">
          <label className="ai-label flex flex-col gap-1">
            Delivery note for the requester (optional)
            <textarea className="input min-h-20" maxLength={5000} value={notesText} onChange={(e) => setNotesText(e.target.value)} placeholder="How to use it, where it lives, what to do next..." />
          </label>
          <button type="button" className="btn ai-btn-green mt-3" disabled={pending || !d.deliverables.length} onClick={() => act(() => deliverAction(t.id, notesText))}>
            Mark as Delivered
          </button>
          {!d.deliverables.length && <p className="mt-2 text-xs ai-muted">Upload at least one deliverable first.</p>}
        </Card>
      )}
    </div>
  );
}

/** The team's page for one request: header and controls, then Overview, Notes and Deliverables. */
export function RequestView({ d, viewer }: { d: AdminDetail; viewer: Viewer }) {
  const router = useRouter();
  const confirm = useConfirm();
  const { act, pending } = useAct();
  const [tab, setTab] = useState<Tab>("overview");
  const t = d.card;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-[clamp(1.5rem,2.6vw,2rem)] text-ink">
            <span className="text-[var(--ai-navy)]">{t.number}</span> · {t.title} <StatusBadge status={t.status} />
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <TypeBadge type={t.requestType} />
            <span className="ai-muted">from {t.requesterName ?? "–"}</span>
          </div>
        </div>
        {viewer.lead && (
          <button
            type="button"
            className="btn btn-sm ai-btn-outline-red"
            disabled={pending}
            onClick={async () => {
              if (!(await confirm({ title: `Delete ${t.number}?`, message: "The request, its notes, history and files are deleted for good. The requester is not told.", confirmLabel: "Delete", danger: true }))) return;
              const r = await act(() => deleteAction(t.id));
              if (r.ok) router.push("/aistudio/admin/requests");
            }}
          >
            <Trash2 size={14} /> Delete
          </button>
        )}
      </div>
      {t.status === "pending_review" ? (
        <div className="ai-card flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
          <span>This request is waiting to be accepted or declined.</span>
          <PendingActions id={t.id} number={t.number} team={d.team.map((p) => ({ id: p.id, name: p.name }))} lead={viewer.lead} />
        </div>
      ) : t.status !== "declined" ? (
        <Controls key={`${t.status}${t.assigneeId}${t.deadline}${t.priority}`} d={d} viewer={viewer} />
      ) : null}
      <div role="tablist" aria-label="Request sections" className="ai-tabs self-start">
        {(["overview", "notes", "deliverables"] as Tab[]).map((x) => (
          <button key={x} type="button" role="tab" className="ai-tab" aria-selected={tab === x} onClick={() => setTab(x)}>
            {x === "overview" ? "Overview" : x === "notes" ? `Notes${d.notes.length ? ` (${d.notes.length})` : ""}` : `Deliverables${d.deliverables.length ? ` (${d.deliverables.length})` : ""}`}
          </button>
        ))}
      </div>
      {tab === "overview" && <Overview d={d} />}
      {tab === "notes" && <Notes d={d} />}
      {tab === "deliverables" && <Deliverables d={d} viewer={viewer} />}
    </div>
  );
}
