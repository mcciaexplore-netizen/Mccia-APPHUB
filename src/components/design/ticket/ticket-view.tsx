"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Lock, MessageCircleQuestion, Trash2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { useConfirm } from "@/components/ConfirmDialog";
import type { Priority, TicketStatus } from "@/db/design-schema";
import type { TicketDetail } from "@/lib/design/detail";
import { askAction, deleteTicketAction, updateTicketAction } from "@/lib/design/actions/tickets";
import { PRIORITIES, PRIORITY_LABEL, STATUS_LABEL } from "@/lib/design/rules";
import { DueText, PriorityBadge, StatusBadge } from "../ui";
import { fromIstInput, toIstInput, useAct } from "./use-act";
import { OverviewTab } from "./overview-tab";
import { ProofsTab } from "./proofs-tab";
import { SourceTab } from "./source-tab";
import { FigmaTab } from "./figma-tab";
import { AnnotateTab } from "./annotate-tab";

const MOVABLE: TicketStatus[] = ["new", "assigned", "in_progress", "waiting_on_requester", "in_review", "delivered", "closed", "closed_without_approval"];
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "proofs", label: "Proofs & approval" },
  { key: "source", label: "Source files" },
  { key: "figma", label: "Figma" },
  { key: "annotate", label: "Annotate" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export type Viewer = { id: string; lead: boolean };

/** The ticket page: header with the lead's pickers and the status, then five tabs. Everything a designer does on one ticket. */
export function TicketView({ d, viewer }: { d: TicketDetail; viewer: Viewer }) {
  const router = useRouter();
  const sp = useSearchParams();
  const first = TABS.some((t) => t.key === sp.get("tab")) ? (sp.get("tab") as TabKey) : "overview";
  const [tab, setTab] = useState<TabKey>(first);
  const { act, pending } = useAct();
  const confirm = useConfirm();
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");
  const t = d.card;
  const locked = t.isLocked;
  const accepted = t.status !== "pending_review" && t.status !== "declined";
  const editable = !locked && accepted;

  const save = (patch: Parameters<typeof updateTicketAction>[1]) => act(() => updateTicketAction(t.id, patch));

  const remove = async () => {
    if (!(await confirm({ title: `Delete ${t.number}?`, message: "The ticket, its proofs, files, time and history are deleted for good.", confirmLabel: "Delete", danger: true }))) return;
    const r = await act(() => deleteTicketAction(t.id));
    if (r.ok) router.push("/design/admin/board");
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="ds-card px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-[clamp(1.3rem,2.4vw,1.7rem)] text-ink">
              <span className="text-[var(--ds-navy)]">{t.number}</span>
              <span className="ds-muted">·</span>
              <span className="min-w-0 break-words">{t.title}</span>
              <StatusBadge status={t.status} />
              <PriorityBadge priority={t.priority} />
            </h1>
            {d.versions.length > 1 && (
              <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs ds-muted">
                Versions:
                {d.versions.map((v) =>
                  v.id === t.id ? (
                    <span key={v.id} className="ds-badge ds-tone-blue">
                      {v.number}
                    </span>
                  ) : (
                    <Link key={v.id} href={`/design/admin/tickets/${v.id}`} className="ds-badge ds-tone-neutral hover:underline">
                      {v.number}
                    </Link>
                  ),
                )}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {accepted && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsking(true)}>
                <MessageCircleQuestion size={15} /> Ask the requester
              </button>
            )}
            {viewer.lead && (
              <button type="button" className="btn btn-sm ds-btn-outline-red" onClick={remove} disabled={pending}>
                <Trash2 size={15} /> Delete
              </button>
            )}
          </div>
        </div>

        {locked && (
          <p className="mt-3 flex items-center gap-2 rounded-lg bg-[var(--ds-grey-tint)] px-3 py-2 text-sm text-ink">
            <Lock size={15} /> This version is closed{t.status === "superseded" ? ": the requester asked for changes, which are on the newest version" : ""}. It can no longer be changed.
          </p>
        )}
        {!accepted && <p className="mt-3 rounded-lg bg-[var(--ds-amber-tint)] px-3 py-2 text-sm text-[#92400e]">{t.status === "declined" ? `Declined${d.declineReason ? `: ${d.declineReason}` : ""}.` : "Waiting for a design lead to accept this request."}</p>}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="ds-label flex flex-col gap-1">
            Status
            {editable ? (
              <select className="input" value={t.status} disabled={pending} onChange={(e) => save({ status: e.target.value as TicketStatus })}>
                {MOVABLE.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-sm font-normal normal-case tracking-normal text-ink">{STATUS_LABEL[t.status]}</span>
            )}
          </label>
          <label className="ds-label flex flex-col gap-1">
            Assigned to
            {viewer.lead && editable ? (
              <select className="input" value={t.assigneeId ?? ""} disabled={pending} onChange={(e) => save({ assigneeId: e.target.value || null })}>
                <option value="">Not assigned</option>
                {d.assignable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                {t.assigneeId && !d.assignable.some((p) => p.id === t.assigneeId) && <option value={t.assigneeId}>{t.assigneeName}</option>}
              </select>
            ) : (
              <span className="text-sm font-normal normal-case tracking-normal text-ink">{t.assigneeName ?? "Not assigned"}</span>
            )}
          </label>
          <label className="ds-label flex flex-col gap-1">
            Priority
            {viewer.lead && editable ? (
              <select className="input" value={t.priority} disabled={pending} onChange={(e) => save({ priority: e.target.value as Priority })}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-sm font-normal normal-case tracking-normal text-ink">{PRIORITY_LABEL[t.priority]}</span>
            )}
          </label>
          <label className="ds-label flex flex-col gap-1">
            Due (IST)
            {viewer.lead && editable ? (
              <input
                type="datetime-local"
                className="input"
                defaultValue={toIstInput(t.dueAt)}
                disabled={pending}
                onBlur={(e) => {
                  const next = fromIstInput(e.target.value);
                  if (next !== (t.dueAt ? new Date(t.dueAt).toISOString() : null)) save({ dueAt: next });
                }}
              />
            ) : (
              <span className="text-sm font-normal normal-case tracking-normal">
                <DueText dueAt={t.dueAt} status={t.status} />
              </span>
            )}
          </label>
        </div>
      </div>

      <div role="tablist" aria-label="Ticket sections" className="ds-tabs self-start">
        {TABS.map((x) => (
          <button key={x.key} type="button" role="tab" className="ds-tab" aria-selected={tab === x.key} onClick={() => setTab(x.key)}>
            {x.label}
            {x.key === "proofs" && d.proofs.length > 0 && ` (${d.proofs.length})`}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === "overview" && <OverviewTab d={d} viewer={viewer} editable={editable} />}
        {tab === "proofs" && <ProofsTab d={d} editable={editable} />}
        {tab === "source" && <SourceTab d={d} viewer={viewer} />}
        {tab === "figma" && <FigmaTab d={d} editable={editable} />}
        {tab === "annotate" && <AnnotateTab d={d} viewer={viewer} />}
      </div>

      {asking && (
        <Modal title={`Ask the requester about ${t.number}`} onClose={() => setAsking(false)}>
          <p className="mb-3 text-sm ds-muted">They get it by email and in the hub bell. The question is noted in the ticket&apos;s history.</p>
          <label className="ds-label flex flex-col gap-1">
            Question
            <textarea className="input min-h-28" value={question} maxLength={1000} onChange={(e) => setQuestion(e.target.value)} />
          </label>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAsking(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-sm ds-btn-navy"
              disabled={pending || !question.trim()}
              onClick={async () => {
                const r = await act(() => askAction(t.id, question));
                if (r.ok) {
                  setQuestion("");
                  setAsking(false);
                }
              }}
            >
              Send question
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
