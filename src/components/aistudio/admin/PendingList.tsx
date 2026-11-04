"use client";

import Link from "next/link";
import { useState } from "react";
import { Modal } from "@/components/Modal";
import type { Priority } from "@/db/aistudio-schema";
import { acceptAction, declineAction } from "@/lib/aistudio/actions/admin";
import { PRIORITIES, PRIORITY_LABEL } from "@/lib/aistudio/aistudio.manifest";
import type { RequestCard } from "@/lib/aistudio/queries";
import { useAct } from "../use-act";
import { Empty, TypeBadge, formatDateTime } from "../ui";

type Person = { id: string; name: string };
export type PendingItem = RequestCard & { excerpt: string };

/**
 * Accept (green: who works on it, by when, how urgent, and a note the requester sees) and Decline (red, with the reason the requester is
 * told). Leads only; members see the request waiting. Used in the Pending Review list and on a pending request's own page.
 */
export function PendingActions({ id, number, team, lead }: { id: string; number: string; team: Person[]; lead: boolean }) {
  const { act, pending } = useAct();
  const [dialog, setDialog] = useState<"accept" | "decline" | null>(null);
  const [assignee, setAssignee] = useState("");
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState<Priority | "">("normal");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  if (!lead) return <p className="text-xs ai-muted">Waiting for an AI Studio lead to accept or decline it.</p>;
  return (
    <>
      <div className="flex shrink-0 flex-wrap gap-2">
        <button type="button" className="btn btn-sm ai-btn-green" onClick={() => setDialog("accept")}>
          Accept
        </button>
        <button type="button" className="btn btn-sm ai-btn-outline-red" onClick={() => setDialog("decline")}>
          Decline
        </button>
      </div>
      {dialog === "accept" && (
        <Modal title={`Accept ${number}`} onClose={() => setDialog(null)}>
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await act(() => acceptAction(id, { assigneeId: assignee || null, deadline: deadline || null, priority: priority || null, note }));
              if (r.ok) setDialog(null);
            }}
          >
            <label className="ai-label flex flex-col gap-1">
              Assign to
              <select className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">Not yet</option>
                {team.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
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
            </div>
            <label className="ai-label flex flex-col gap-1">
              Note to the requester (optional)
              <textarea className="input min-h-20" maxLength={5000} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button className="btn btn-sm ai-btn-green" disabled={pending}>
                Confirm
              </button>
            </div>
          </form>
        </Modal>
      )}
      {dialog === "decline" && (
        <Modal title={`Decline ${number}`} onClose={() => setDialog(null)}>
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await act(() => declineAction(id, reason));
              if (r.ok) setDialog(null);
            }}
          >
            <label className="ai-label flex flex-col gap-1">
              Reason (the requester is told)
              <textarea className="input min-h-24" required maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <div className="mt-2 flex justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button className="btn btn-sm btn-danger" disabled={pending || !reason.trim()}>
                Decline request
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

/** Requests waiting for a lead, oldest first: number, title, requester, department, type, when, and Accept / Decline. */
export function PendingList({ items, team, lead, limit }: { items: PendingItem[]; team: Person[]; lead: boolean; limit?: number }) {
  if (!items.length) return <Empty title="No requests waiting">New requests appear here for a lead to accept or decline.</Empty>;
  const shown = limit ? items.slice(0, limit) : items;
  return (
    <>
      <ul className="divide-y divide-[var(--ai-line)]">
        {shown.map((t) => (
          <li key={t.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/aistudio/admin/requests/${t.id}`} className="text-sm font-bold text-[var(--ai-navy)] hover:underline">
                  {t.number}
                </Link>
                <TypeBadge type={t.requestType} />
              </div>
              <p className="mt-1 font-semibold text-ink">{t.title}</p>
              <p className="mt-0.5 text-[0.82rem] ai-muted" suppressHydrationWarning>
                {t.requesterName ?? "Unknown requester"}
                {t.department ? ` · ${t.department}` : ""} · submitted {formatDateTime(t.createdAt)}
              </p>
              {t.excerpt && <p className="mt-1.5 line-clamp-2 text-[0.84rem] text-ink">{t.excerpt}</p>}
            </div>
            <PendingActions id={t.id} number={t.number} team={team} lead={lead} />
          </li>
        ))}
      </ul>
      {limit && items.length > limit && (
        <div className="border-t border-[var(--ai-line)] px-5 py-3 text-sm">
          <Link href="/aistudio/admin/pending" className="font-semibold text-[var(--ai-navy)] hover:underline">
            See all {items.length} waiting requests →
          </Link>
        </div>
      )}
    </>
  );
}
