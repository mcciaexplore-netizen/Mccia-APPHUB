"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarDays, Download, FilePlus2, FileText, FileUp, MessageSquare, Pencil, Paperclip, Trash2, UserMinus, UserPlus, GitCompareArrows } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { Modal } from "@/components/Modal";
import type { Priority, ProjectStatus } from "@/db/eru-schema";
import {
  addProjectFileAction,
  createDocumentAction,
  deleteDocumentAction,
  deleteProjectAction,
  manageProjectAction,
  removeProjectFileAction,
  setAssigneesAction,
  updateDetailsAction,
} from "@/lib/eru/actions/workspace";
import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL } from "@/lib/eru/eru.manifest";
import { formatBytes, IMPORT_ACCEPT, importKind } from "@/lib/eru/file-types";
import type { ActivityItem, DocumentSummary, FileSummary } from "@/lib/eru/queries";
import { Avatar, Avatars, Badge, Card, describeActivity, DomainBadge, Empty, exportHref, fileHref, formatDateTime, formatDay, isOverdue, PriorityBadge, StatusBadge } from "../ui";
import { useAct } from "../use-act";
import { uploadFile } from "../upload";

type Person = { id: string; name: string; email?: string };
export type ProjectViewProps = {
  project: {
    id: string;
    number: string;
    title: string;
    description: string;
    status: ProjectStatus;
    priority: Priority;
    dueDate: string | null;
    tags: string[];
    referenceLinks: string[];
    createdByName: string;
    createdAt: string;
  };
  domain: { id: string; key: string; name: string; color: string };
  domains: { id: string; name: string }[];
  assigned: Person[];
  documents: DocumentSummary[];
  files: FileSummary[];
  activity: ActivityItem[];
  team: Person[];
  me: { id: string; admin: boolean };
};

/** A project: its header (admins change status, priority, due date and domain there), Overview and Members. */
export function ProjectView(props: ProjectViewProps) {
  const { project: p, domain, me } = props;
  const [tab, setTab] = useState<"overview" | "members">("overview");
  const { act, pending } = useAct();
  const confirm = useConfirm();
  const router = useRouter();
  const late = isOverdue(p.dueDate) && p.status !== "completed" && p.status !== "archived";

  return (
    <div className="flex flex-col gap-5">
      <header className="eru-card flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono font-bold text-[var(--eru-navy)]">{p.number}</span>
          <span aria-hidden className="eru-muted">·</span>
          <h1 className="text-[1.45rem] leading-tight text-ink">{p.title}</h1>
          <StatusBadge status={p.status} />
          <PriorityBadge priority={p.priority} />
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm eru-muted">
          <DomainBadge name={domain.name} color={domain.color} />
          <span className={`flex items-center gap-1 ${late ? "font-bold text-[var(--eru-red)]" : ""}`}>
            <CalendarDays size={14} aria-hidden /> {p.dueDate ? `Due ${formatDay(p.dueDate)}${late ? " (overdue)" : ""}` : "No due date"}
          </span>
          <Avatars people={props.assigned} max={6} />
          <span className="text-xs">
            Created by {p.createdByName}, {formatDateTime(p.createdAt)}
          </span>
        </div>
        {me.admin && (
          <div className="flex flex-wrap items-end gap-3 border-t border-[var(--eru-line)] pt-3" aria-label="Manage project">
            <label className="flex flex-col gap-1 text-xs font-semibold eru-muted">
              Status
              <select className="input py-1.5 text-sm" value={p.status} disabled={pending} onChange={(e) => act(() => manageProjectAction(p.id, { status: e.target.value as ProjectStatus }))}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold eru-muted">
              Priority
              <select className="input py-1.5 text-sm" value={p.priority} disabled={pending} onChange={(e) => act(() => manageProjectAction(p.id, { priority: e.target.value as Priority }))}>
                {PRIORITIES.map((s) => (
                  <option key={s} value={s}>
                    {PRIORITY_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold eru-muted">
              Due date
              <input type="date" className="input py-1.5 text-sm" defaultValue={p.dueDate ?? ""} disabled={pending} onBlur={(e) => e.target.value !== (p.dueDate ?? "") && act(() => manageProjectAction(p.id, { dueDate: e.target.value || null }))} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold eru-muted">
              Domain
              <select className="input py-1.5 text-sm" value={domain.id} disabled={pending} onChange={(e) => act(() => manageProjectAction(p.id, { domainId: e.target.value }))}>
                {props.domains.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn eru-btn-red btn-sm ml-auto"
              disabled={pending}
              onClick={async () => {
                if (!(await confirm({ title: `Delete ${p.number}?`, message: "The project, its documents, comments, tracked changes, files and history are deleted for good.", confirmLabel: "Delete", danger: true }))) return;
                const r = await act(() => deleteProjectAction(p.id), { noRefresh: true });
                if (r.ok) router.push(r.data.domainKey ? `/eru/domains/${r.data.domainKey}` : "/eru");
              }}
            >
              <Trash2 size={14} aria-hidden /> Delete project
            </button>
          </div>
        )}
      </header>

      <div className="eru-tabs" role="tablist" aria-label="Project">
        <button type="button" role="tab" className="eru-tab" aria-selected={tab === "overview"} onClick={() => setTab("overview")}>
          Overview
        </button>
        <button type="button" role="tab" className="eru-tab" aria-selected={tab === "members"} onClick={() => setTab("members")}>
          Members ({props.assigned.length})
        </button>
      </div>

      {tab === "overview" ? <Overview {...props} /> : <Members {...props} />}
    </div>
  );
}

function Overview(props: ProjectViewProps) {
  const { project: p, me } = props;
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-5">
        <Documents projectId={p.id} documents={props.documents} admin={me.admin} />
        <Details project={p} />
      </div>
      <div className="flex min-w-0 flex-col gap-5">
        <Files projectId={p.id} files={props.files} me={me} />
        <Activity items={props.activity} />
      </div>
    </div>
  );
}

function Documents({ projectId, documents, admin }: { projectId: string; documents: DocumentSummary[]; admin: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { act } = useAct();
  const [busy, setBusy] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function createBlank(title: string) {
    setBusy("Creating…");
    const r = await createDocumentAction(projectId, { title });
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    router.push(`/eru/documents/${r.data.id}`);
  }

  async function importFile(file: File) {
    const kind = importKind(file.name);
    if (!kind) return toast.error("Choose a Word document (.docx), a PDF or a PowerPoint (.pptx). Other files go under Files.");
    try {
      setBusy(kind === "docx" ? "Reading the document…" : "Converting…");
      const { fileToContent, titleFromFile } = await import("./import-file");
      const { content, converted } = await fileToContent(file, kind);
      setBusy("Uploading the original…");
      const up = await uploadFile(file);
      setBusy("Creating the document…");
      const r = await createDocumentAction(projectId, { title: titleFromFile(file.name), content, originalFileId: up.fileId });
      if (!r.ok) throw new Error(r.error);
      toast.success("Imported");
      // A converted PDF or presentation opens with a note that some formatting may not have come across.
      router.push(`/eru/documents/${r.data.id}${converted ? "?converted=1" : ""}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The document could not be imported.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card
      pad={false}
      title="Documents"
      actions={
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => setNaming(true)}>
            <FilePlus2 size={14} aria-hidden /> New document
          </button>
          <button type="button" className="btn eru-btn-navy btn-sm" disabled={!!busy} title="A Word document (.docx), a PDF or a PowerPoint (.pptx), to edit here" onClick={() => input.current?.click()}>
            <FileUp size={14} aria-hidden /> {busy ?? "Upload document"}
          </button>
          <input
            ref={input}
            type="file"
            accept={IMPORT_ACCEPT}
            className="sr-only"
            aria-label="Upload a document (Word, PDF or PowerPoint)"
            data-testid="eru-docx-input"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void importFile(f);
            }}
          />
        </div>
      }
    >
      {documents.length ? (
        <ul className="divide-y divide-[var(--eru-line)]">
          {documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5" data-testid="eru-document-row">
              <FileText size={18} className="shrink-0 text-[var(--eru-navy)]" aria-hidden />
              <div className="min-w-0 flex-1">
                <Link href={`/eru/documents/${d.id}`} className="font-semibold text-ink hover:underline">
                  {d.title}
                </Link>
                <p className="text-xs eru-muted">
                  Last edited by {d.lastEditedBy || "—"}, {formatDateTime(d.updatedAt)}
                </p>
              </div>
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge tone={d.comments ? "amber" : "neutral"} title="Open comments">
                  <MessageSquare size={11} aria-hidden /> {d.comments}
                </Badge>
                <Badge tone={d.pendingChanges ? "purple" : "neutral"} title="Tracked changes waiting for review">
                  <GitCompareArrows size={11} aria-hidden /> {d.pendingChanges}
                </Badge>
                {d.trackChanges && <Badge tone="green">Tracking</Badge>}
              </span>
              <span className="flex gap-1.5">
                <Link href={`/eru/documents/${d.id}`} className="btn eru-btn-navy btn-sm">
                  <Pencil size={13} aria-hidden /> Edit
                </Link>
                <a href={exportHref(d.id)} className="btn btn-ghost btn-sm" download>
                  <Download size={13} aria-hidden /> .docx
                </a>
                {admin && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    aria-label={`Delete ${d.title}`}
                    onClick={async () => {
                      if (await confirm({ title: `Delete "${d.title}"?`, message: "The document, its comments and tracked changes are deleted for good.", confirmLabel: "Delete", danger: true }))
                        await act(() => deleteDocumentAction(d.id));
                    }}
                  >
                    <Trash2 size={13} aria-hidden />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="No documents yet">Upload a Word document (.docx), a PDF or a PowerPoint (.pptx) to edit it here, or start a new one.</Empty>
      )}
      {naming && (
        <Modal title="New document" onClose={() => setNaming(false)}>
          <form
            className="flex flex-col gap-4"
            action={(f) => {
              setNaming(false);
              void createBlank(String(f.get("title") ?? ""));
            }}
          >
            <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
              Title
              <input name="title" className="input" maxLength={200} placeholder="Untitled document" autoFocus />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setNaming(false)}>
                Cancel
              </button>
              <button type="submit" className="btn eru-btn-navy">
                Create and open
              </button>
            </div>
          </form>
        </Modal>
      )}
    </Card>
  );
}

function Details({ project: p }: { project: ProjectViewProps["project"] }) {
  const [editing, setEditing] = useState(false);
  const { act, pending } = useAct();
  if (editing)
    return (
      <Card title="Details">
        <form
          className="flex flex-col gap-4"
          action={async (f) => {
            const r = await act(() =>
              updateDetailsAction(p.id, {
                title: String(f.get("title") ?? ""),
                description: String(f.get("description") ?? ""),
                tags: String(f.get("tags") ?? "").split(","),
                referenceLinks: String(f.get("links") ?? "").split(/\s+/),
              }),
            );
            if (r.ok) setEditing(false);
          }}
        >
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
            Title
            <input name="title" className="input" defaultValue={p.title} required minLength={3} maxLength={200} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
            Description
            <textarea name="description" className="input" rows={5} defaultValue={p.description} maxLength={10000} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
            Tags <span className="text-xs font-normal eru-muted">separated by commas</span>
            <input name="tags" className="input" defaultValue={p.tags.join(", ")} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold text-ink">
            Reference links <span className="text-xs font-normal eru-muted">one per line</span>
            <textarea name="links" className="input" rows={3} defaultValue={p.referenceLinks.join("\n")} />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" className="btn eru-btn-navy" disabled={pending}>
              Save
            </button>
          </div>
        </form>
      </Card>
    );
  return (
    <Card
      title="Details"
      actions={
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
          <Pencil size={13} aria-hidden /> Edit
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="eru-label mb-1">Description</p>
          {p.description ? <p className="whitespace-pre-wrap text-[0.92rem] text-ink">{p.description}</p> : <p className="text-sm eru-muted">No description yet.</p>}
        </div>
        <div>
          <p className="eru-label mb-1">Tags</p>
          {p.tags.length ? (
            <div className="flex flex-wrap gap-1.5">
              {p.tags.map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm eru-muted">No tags.</p>
          )}
        </div>
        <div>
          <p className="eru-label mb-1">Reference links</p>
          {p.referenceLinks.length ? (
            <ul className="flex flex-col gap-1">
              {p.referenceLinks.map((l) => (
                <li key={l} className="truncate text-sm">
                  <a href={l} target="_blank" rel="noopener noreferrer" className="text-[#1d4ed8] hover:underline">
                    {l}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm eru-muted">No links.</p>
          )}
        </div>
      </div>
    </Card>
  );
}

function Files({ projectId, files, me }: { projectId: string; files: FileSummary[]; me: { id: string; admin: boolean } }) {
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const { act } = useAct();
  const [progress, setProgress] = useState<number | null>(null);

  async function upload(list: FileList) {
    for (const file of Array.from(list)) {
      try {
        setProgress(0);
        const up = await uploadFile(file, setProgress);
        const r = await act(() => addProjectFileAction(projectId, up.fileId), { quiet: true });
        if (r.ok) toast.success(`Uploaded ${file.name}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "The file could not be uploaded.");
      }
    }
    setProgress(null);
  }

  return (
    <Card
      pad={false}
      title="Files"
      actions={
        <>
          <button type="button" className="btn btn-ghost btn-sm" disabled={progress !== null} onClick={() => input.current?.click()}>
            <Paperclip size={13} aria-hidden /> {progress !== null ? `Uploading ${progress}%` : "Upload files"}
          </button>
          <input
            ref={input}
            type="file"
            multiple
            className="sr-only"
            aria-label="Upload files"
            onChange={(e) => {
              if (e.target.files?.length) void upload(e.target.files);
              e.target.value = "";
            }}
          />
        </>
      }
    >
      {files.length ? (
        <ul className="divide-y divide-[var(--eru-line)]">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 px-5 py-2.5 text-sm">
              <a href={fileHref(f.id)} className="min-w-0 flex-1 truncate font-semibold text-ink hover:underline" title={f.fileName}>
                {f.fileName}
              </a>
              <span className="shrink-0 text-xs eru-muted">{formatBytes(f.size)}</span>
              {(me.admin || f.uploadedById === me.id) && (
                <button
                  type="button"
                  className="eru-tool"
                  aria-label={`Remove ${f.fileName}`}
                  onClick={async () => {
                    if (await confirm({ title: `Remove ${f.fileName}?`, message: "The file is deleted for good.", confirmLabel: "Remove", danger: true })) await act(() => removeProjectFileAction(f.id));
                  }}
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-6 text-center text-sm eru-muted">Data, spreadsheets, PDFs and other files for this project.</p>
      )}
    </Card>
  );
}

function Activity({ items }: { items: ActivityItem[] }) {
  return (
    <Card title="Activity" pad={false}>
      {items.length ? (
        <ol className="flex max-h-[28rem] flex-col overflow-y-auto">
          {items.map((a) => (
            <li key={a.id} className="border-b border-[var(--eru-line)] px-5 py-2.5 text-sm last:border-0">
              <span className="font-semibold text-ink">{a.who || "Someone"}</span> <span className="text-ink">{describeActivity(a.action, a.details)}</span>
              <p className="text-xs eru-muted">{formatDateTime(a.at)}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-5 py-6 text-center text-sm eru-muted">Nothing yet.</p>
      )}
    </Card>
  );
}

function Members({ project: p, assigned, team, me }: ProjectViewProps) {
  const { act, pending } = useAct();
  const [adding, setAdding] = useState("");
  const ids = assigned.map((a) => a.id);
  const addable = team.filter((t) => !ids.includes(t.id));
  return (
    <Card title="Assigned members" pad={false}>
      {assigned.length ? (
        <ul className="divide-y divide-[var(--eru-line)]">
          {assigned.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-5 py-3">
              <Avatar name={a.name} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-ink">{a.name}</span>
                {a.email && <span className="block truncate text-xs eru-muted">{a.email}</span>}
              </span>
              {me.admin && (
                <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => act(() => setAssigneesAction(p.id, ids.filter((x) => x !== a.id)))}>
                  <UserMinus size={13} aria-hidden /> Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="Nobody is assigned" />
      )}
      {me.admin ? (
        <form
          className="flex flex-wrap items-center gap-2 border-t border-[var(--eru-line)] px-5 py-4"
          action={async () => {
            if (!adding) return;
            const r = await act(() => setAssigneesAction(p.id, [...ids, adding]));
            if (r.ok) setAdding("");
          }}
        >
          <select className="input min-w-[14rem] flex-1" value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Team member to assign">
            <option value="">{addable.length ? "Choose a team member…" : "Everyone in the team is assigned"}</option>
            {addable.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button type="submit" className="btn eru-btn-navy btn-sm" disabled={!adding || pending}>
            <UserPlus size={13} aria-hidden /> Assign
          </button>
        </form>
      ) : (
        <p className="border-t border-[var(--eru-line)] px-5 py-3 text-xs eru-muted">An ERU admin changes who is assigned.</p>
      )}
    </Card>
  );
}
