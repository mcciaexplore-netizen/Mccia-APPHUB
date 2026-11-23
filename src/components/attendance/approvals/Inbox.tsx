"use client";

import { useRef, useState, type ReactNode } from "react";
import { Paperclip } from "lucide-react";
import { Modal } from "@/components/Modal";
import { decideAction } from "@/lib/attendance/actions/staff";
import { REQUEST_KIND_LABEL, type RequestKind } from "@/lib/attendance/att.manifest";
import type { InboxItem } from "@/lib/attendance/approvals";
import { formatMoment } from "@/lib/attendance/time";
import { Avatar, Badge, Empty, RequestStatus } from "../ui";
import { useAct } from "../use-act";

const KIND_TONE: Record<RequestKind, "blue" | "teal" | "amber" | "purple" | "green" | "red"> = { leave: "blue", wfh: "teal", early: "red", regularization: "amber", compoff: "purple", timesheet: "green" };

/**
 * Requests waiting for a decision, or past decisions. Approve / Reject (with a remark) only on what the viewer may decide (item.canAct): a
 * manager their team's requests, HR only what was sent to HR. Everything else is read only and says who it is waiting for or who decided it.
 */
export function Inbox({ items, mode, showApprover = false }: { items: InboxItem[]; mode: "pending" | "history"; showApprover?: boolean }) {
  const [kind, setKind] = useState<RequestKind | "all">("all");
  const [deciding, setDeciding] = useState<{ item: InboxItem; approve: boolean } | null>(null);
  const shown = kind === "all" ? items : items.filter((i) => i.kind === kind);
  const counts = items.reduce<Record<string, number>>((m, i) => ({ ...m, [i.kind]: (m[i.kind] ?? 0) + 1 }), {});
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 border-b border-[var(--att-line)] px-5 py-3">
        {(["all", "leave", "wfh", "early", "regularization", "compoff", "timesheet"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={`att-badge ${kind === k ? "att-tone-primary" : "att-tone-neutral"}`} aria-pressed={kind === k}>
            {k === "all" ? "All" : REQUEST_KIND_LABEL[k]} {k === "all" ? items.length : (counts[k] ?? 0)}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <Empty title={mode === "pending" ? "Nothing waiting" : "No decisions yet"}>{mode === "pending" ? "Requests sent to you appear here." : ""}</Empty>
      ) : (
        <ul className="divide-y divide-[var(--att-line)] overflow-hidden">
          {mode === "pending" && shown.some((i) => i.canAct) && <li className="px-5 py-2 text-xs text-gray-500 md:hidden">Tip: swipe a request right to approve, left to reject.</li>}
          {shown.map((i) => (
            <SwipeRow key={`${i.kind}-${i.id}`} enabled={mode === "pending" && i.canAct} onApprove={() => setDeciding({ item: i, approve: true })} onReject={() => setDeciding({ item: i, approve: false })}>
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
                  {mode === "pending"
                    ? `Asked ${formatMoment(i.createdAt)}`
                    : `${i.status === "rejected" ? "Rejected" : i.status === "cancelled" ? "Decided" : "Approved"} by ${i.decider ?? "—"}${i.decidedAt ? ` on ${formatMoment(i.decidedAt)}` : ""}${i.status === "cancelled" ? " (later withdrawn)" : ""}`}
                  {mode === "history" && i.remark && ` · “${i.remark}”`}
                </p>
                {mode === "pending" && (showApprover || !i.canAct) && (
                  <p className="mt-1.5 text-xs font-semibold">
                    {i.toHr ? (
                      <span className="text-[#b45309]">{i.approverId ? `Manager ${i.approver} is no longer active - sent to HR for approval` : "No manager assigned - sent to HR for approval"}</span>
                    ) : (
                      <span className="text-gray-500">Waiting for {i.approver} (reporting manager)</span>
                    )}
                  </p>
                )}
              </div>
              {mode === "pending" && i.canAct && (
                <div className="flex shrink-0 gap-2">
                  <button type="button" className="btn btn-ghost btn-sm flex-1 text-[var(--att-red)] sm:flex-none" onClick={() => setDeciding({ item: i, approve: false })}>
                    Reject
                  </button>
                  <button type="button" className="btn btn-primary btn-sm flex-1 sm:flex-none" onClick={() => setDeciding({ item: i, approve: true })}>
                    Approve
                  </button>
                </div>
              )}
            </SwipeRow>
          ))}
        </ul>
      )}
      {deciding && <DecideDialog {...deciding} onClose={() => setDeciding(null)} />}
    </div>
  );
}

/**
 * One request in the list. On a touch screen it can be swiped: right past 90 px opens Approve, left opens Reject (both then ask for the
 * remark as usual). The buttons are always there too.
 */
function SwipeRow({ enabled, onApprove, onReject, children }: { enabled: boolean; onApprove: () => void; onReject: () => void; children: ReactNode }) {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const THRESHOLD = 90;
  const end = () => {
    if (dx > THRESHOLD) onApprove();
    else if (dx < -THRESHOLD) onReject();
    start.current = null;
    setDragging(false);
    setDx(0);
  };
  return (
    <li className="relative">
      {enabled && dx !== 0 && (
        <div className="att-swipe-hint" style={{ background: dx > 0 ? "var(--att-primary-tint)" : "var(--att-red-tint)" }} aria-hidden>
          <span className="text-[var(--att-primary-2)]">{dx > 0 ? (dx > THRESHOLD ? "Release to approve" : "Approve") : ""}</span>
          <span className="text-[var(--att-red)]">{dx < 0 ? (dx < -THRESHOLD ? "Release to reject" : "Reject") : ""}</span>
        </div>
      )}
      <div
        className={`att-swipe flex flex-col gap-2 bg-(--att-card) px-5 py-4 sm:flex-row sm:items-start ${dragging ? "att-dragging" : ""}`}
        style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        onPointerDown={(e) => {
          if (!enabled || e.pointerType !== "touch") return;
          start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
        }}
        onPointerMove={(e) => {
          const s0 = start.current;
          if (!s0 || s0.id !== e.pointerId) return;
          const x = e.clientX - s0.x;
          const y = e.clientY - s0.y;
          if (!dragging && Math.abs(x) < 12) return;
          if (!dragging && Math.abs(y) > Math.abs(x)) {
            start.current = null; // a scroll, not a swipe
            return;
          }
          setDragging(true);
          setDx(Math.max(-140, Math.min(140, x)));
        }}
        onPointerUp={end}
        onPointerCancel={() => {
          start.current = null;
          setDragging(false);
          setDx(0);
        }}
      >
        {children}
      </div>
    </li>
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
