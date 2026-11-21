"use client";

import { useState } from "react";
import { Paperclip } from "lucide-react";
import { Modal } from "@/components/Modal";
import { decideAction } from "@/lib/attendance/actions/staff";
import { REQUEST_KIND_LABEL, type RequestKind } from "@/lib/attendance/att.manifest";
import type { InboxItem } from "@/lib/attendance/approvals";
import { formatMoment } from "@/lib/attendance/time";
import { Avatar, Badge, Empty, RequestStatus } from "../ui";
import { useAct } from "../use-act";

const KIND_TONE: Record<RequestKind, "blue" | "teal" | "amber" | "purple" | "green"> = { leave: "blue", wfh: "teal", regularization: "amber", compoff: "purple", timesheet: "green" };

/** Requests waiting for a decision (approve, or reject with a remark), or past decisions. Used by managers and by HR. */
export function Inbox({ items, mode, showApprover = false }: { items: InboxItem[]; mode: "pending" | "history"; showApprover?: boolean }) {
  const [kind, setKind] = useState<RequestKind | "all">("all");
  const [deciding, setDeciding] = useState<{ item: InboxItem; approve: boolean } | null>(null);
  const shown = kind === "all" ? items : items.filter((i) => i.kind === kind);
  const counts = items.reduce<Record<string, number>>((m, i) => ({ ...m, [i.kind]: (m[i.kind] ?? 0) + 1 }), {});
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 border-b border-[var(--att-line)] px-5 py-3">
        {(["all", "leave", "wfh", "regularization", "compoff", "timesheet"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={`att-badge ${kind === k ? "att-tone-primary" : "att-tone-neutral"}`} aria-pressed={kind === k}>
            {k === "all" ? "All" : REQUEST_KIND_LABEL[k]} {k === "all" ? items.length : (counts[k] ?? 0)}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <Empty title={mode === "pending" ? "Nothing waiting" : "No decisions yet"}>{mode === "pending" ? "Requests sent to you appear here." : ""}</Empty>
      ) : (
        <ul className="divide-y divide-[var(--att-line)]">
          {shown.map((i) => (
            <li key={`${i.kind}-${i.id}`} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start">
              <Avatar name={i.person} size={34} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-bold text-ink">{i.person}</span>
                  <Badge tone={KIND_TONE[i.kind]}>{REQUEST_KIND_LABEL[i.kind]}</Badge>
                  {mode === "history" && <RequestStatus status={i.status} />}
                </p>
                <p className="mt-0.5 text-sm text-ink">
                  <span className="font-semibold">{i.title}</span> · {i.when}
                  {i.detail && <span className="att-muted"> · {i.detail}</span>}
                </p>
                {i.reason && <p className="mt-1 text-sm text-ink/80">“{i.reason}”</p>}
                {i.attachment && (
                  <a href={`/api/attendance/files/${i.id}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[var(--att-primary)]">
                    <Paperclip size={12} aria-hidden /> Supporting document
                  </a>
                )}
                <p className="mt-1 text-xs att-muted">
                  {mode === "pending" ? `Asked ${formatMoment(i.createdAt)}` : `Decided ${i.decidedAt ? formatMoment(i.decidedAt) : ""}`}
                  {showApprover && ` · sent to ${i.approver ?? "HR"}`}
                  {mode === "history" && i.remark && ` · “${i.remark}”`}
                </p>
              </div>
              {mode === "pending" && (
                <div className="flex shrink-0 gap-2">
                  <button type="button" className="btn btn-ghost btn-sm text-[var(--att-red)]" onClick={() => setDeciding({ item: i, approve: false })}>
                    Reject
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => setDeciding({ item: i, approve: true })}>
                    Approve
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {deciding && <DecideDialog {...deciding} onClose={() => setDeciding(null)} />}
    </div>
  );
}

function DecideDialog({ item, approve, onClose }: { item: InboxItem; approve: boolean; onClose: () => void }) {
  const { act, pending } = useAct();
  const [remark, setRemark] = useState("");
  return (
    <Modal title={`${approve ? "Approve" : "Reject"} ${REQUEST_KIND_LABEL[item.kind].toLowerCase()} · ${item.person}`} onClose={onClose}>
      <p className="text-sm">
        <span className="font-semibold">{item.title}</span> · {item.when}
      </p>
      <label className="mt-3 flex flex-col gap-1 text-xs font-semibold att-muted">
        Remark {approve ? "(optional)" : "(required: tell them why)"}
        <textarea className="input" rows={3} maxLength={1000} value={remark} onChange={(e) => setRemark(e.target.value)} autoFocus />
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={`btn btn-sm ${approve ? "btn-primary" : "btn-danger"}`}
          disabled={pending || (!approve && remark.trim().length < 2)}
          onClick={async () => {
            const r = await act(() => decideAction(item.kind, item.id, approve, remark).then((x) => (x.ok ? { ...x, message: x.data } : x)));
            if (r.ok) onClose();
          }}
        >
          {approve ? "Approve" : "Reject"}
        </button>
      </div>
    </Modal>
  );
}
