"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, HelpCircle, Loader2, Sparkles, X } from "lucide-react";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import type { TicketCard } from "@/lib/design/tickets";
import { acceptAction, askAction, assigneeOptionsAction, declineAction } from "@/lib/design/actions/tickets";
import { Badge, Empty, PriorityBadge, formatDateTime, formatDay } from "../ui";

/**
 * The requests waiting for a lead (Pending Review): who asked, for what, by when. Accept + Assign gives it to a chosen person (each shown
 * with their open hours against this week's capacity) or to the best fit automatically; Decline needs a reason the requester is told; Ask
 * question emails the requester and leaves the request waiting.
 */

export type PendingItem = TicketCard & { briefExcerpt: string };
type Option = { id: string; name: string; openHours: number; capacityHours: number; designer: boolean; suggested: boolean };
type Dialog = { kind: "accept" | "decline" | "ask"; ticket: PendingItem } | null;

export function PendingList({ items, limit }: { items: PendingItem[]; limit?: number }) {
  const router = useRouter();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [options, setOptions] = useState<Option[] | null>(null);
  const [choice, setChoice] = useState<string>("auto");
  const [text, setText] = useState("");
  const [busy, startBusy] = useTransition();

  const shown = limit ? items.slice(0, limit) : items;

  const open = (kind: "accept" | "decline" | "ask", ticket: PendingItem) => {
    setDialog({ kind, ticket });
    setText("");
    setChoice("auto");
    if (kind === "accept" && !options) {
      void assigneeOptionsAction().then((r) => {
        if (r.ok) setOptions(r.data);
        else toast.error(r.error);
      });
    }
  };

  const submit = () =>
    startBusy(async () => {
      if (!dialog) return;
      const t = dialog.ticket;
      if (dialog.kind === "accept") {
        const r = await acceptAction(t.id, choice);
        if (!r.ok) return void toast.error(r.error);
        toast.success(r.data.assigned ? `${t.number} accepted and assigned` : `${t.number} accepted. Nobody was free to assign: it waits in New.`);
        setOptions(null);
      } else if (dialog.kind === "decline") {
        const r = await declineAction(t.id, text);
        if (!r.ok) return void toast.error(r.error);
        toast.success(r.message ?? "Declined");
      } else {
        const r = await askAction(t.id, text);
        if (!r.ok) return void toast.error(r.error);
        toast.success(r.message ?? "Question sent");
      }
      setDialog(null);
      router.refresh();
    });

  if (!items.length) return <Empty title="No requests waiting">New design requests appear here for a lead to accept, decline or ask about.</Empty>;

  return (
    <>
      <ul className="divide-y divide-[var(--ds-line)]">
        {shown.map((t) => (
          <li key={t.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-start">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/design/tickets/${t.id}`} className="text-sm font-bold text-[var(--ds-navy)] hover:underline">
                  {t.number}
                </Link>
                <PriorityBadge priority={t.priority} />
                {t.designs.map((d) => (
                  <Badge key={d} tone="blue">
                    {d}
                  </Badge>
                ))}
              </div>
              <p className="mt-1 font-semibold text-ink">{t.title}</p>
              <p className="mt-0.5 text-[0.82rem] ds-muted">
                {t.requesterName ?? "Unknown requester"}
                {t.department ? ` · ${t.department}` : ""} · needed by {t.deliveryDate ? formatDay(t.deliveryDate) : "–"} · asked {formatDateTime(t.createdAt)}
              </p>
              {t.briefExcerpt && <p className="mt-1.5 line-clamp-2 text-[0.84rem] text-ink">{t.briefExcerpt}</p>}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button type="button" className="btn btn-sm ds-btn-navy" onClick={() => open("accept", t)}>
                <Check size={14} /> Accept + Assign
              </button>
              <button type="button" className="btn btn-sm ds-btn-outline-red" onClick={() => open("decline", t)}>
                <X size={14} /> Decline
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => open("ask", t)}>
                <HelpCircle size={14} /> Ask question
              </button>
            </div>
          </li>
        ))}
      </ul>
      {limit && items.length > limit && (
        <div className="border-t border-[var(--ds-line)] px-5 py-3 text-sm">
          <Link href="/design/admin/pending" className="font-semibold text-[var(--ds-navy)] hover:underline">
            See all {items.length} waiting requests →
          </Link>
        </div>
      )}

      {dialog && (
        <Modal
          title={dialog.kind === "accept" ? `Accept ${dialog.ticket.number}` : dialog.kind === "decline" ? `Decline ${dialog.ticket.number}` : `Ask about ${dialog.ticket.number}`}
          onClose={() => setDialog(null)}
        >
          <p className="mb-4 text-sm ds-muted">{dialog.ticket.title}</p>
          {dialog.kind === "accept" ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="ds-label mb-2">Assign to</legend>
              <label className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 ${choice === "auto" ? "border-[var(--ds-navy)] bg-[var(--ds-navy-tint)]" : "border-[var(--ds-line)]"}`}>
                <input type="radio" name="assignee" value="auto" checked={choice === "auto"} onChange={() => setChoice("auto")} />
                <Sparkles size={16} className="text-[var(--ds-navy)]" aria-hidden />
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-ink">Auto-assign (best fit)</span>
                  <span className="block text-xs ds-muted">The designer with the most spare capacity this week, leave and holidays counted</span>
                </span>
              </label>
              {!options ? (
                <p className="flex items-center gap-2 px-1 py-2 text-sm ds-muted">
                  <Loader2 size={14} className="animate-spin" /> Loading the team…
                </p>
              ) : options.length === 0 ? (
                <p className="px-1 py-2 text-sm ds-muted">Nobody has Design Team yet. Give designers the Design Team application in Administrator.</p>
              ) : (
                options.map((o) => {
                  const pct = o.capacityHours ? Math.min(100, Math.round((o.openHours / o.capacityHours) * 100)) : 100;
                  return (
                    <label key={o.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 ${choice === o.id ? "border-[var(--ds-navy)] bg-[var(--ds-navy-tint)]" : "border-[var(--ds-line)]"}`}>
                      <input type="radio" name="assignee" value={o.id} checked={choice === o.id} onChange={() => setChoice(o.id)} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                          {o.name}
                          {o.suggested && <Badge tone="green">Suggested</Badge>}
                          {!o.designer && <Badge tone="neutral">Lead</Badge>}
                        </span>
                        <span className="mt-1 flex items-center gap-2">
                          <span className="h-1.5 w-28 overflow-hidden rounded-full bg-[#e5e7eb]" aria-hidden>
                            <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: pct > 90 ? "var(--ds-red)" : pct > 70 ? "var(--ds-amber)" : "var(--ds-green)" }} />
                          </span>
                          <span className="text-xs ds-muted">
                            {o.openHours}h open{o.capacityHours ? ` of ${o.capacityHours}h this week` : " · no capacity set"}
                          </span>
                        </span>
                      </span>
                    </label>
                  );
                })
              )}
            </fieldset>
          ) : (
            <label className="flex flex-col gap-1.5">
              <span className="ds-label">{dialog.kind === "decline" ? "Reason (the requester is told)" : "Your question (emailed to the requester)"}</span>
              <textarea className="input min-h-28" value={text} maxLength={dialog.kind === "decline" ? 500 : 1000} onChange={(e) => setText(e.target.value)} autoFocus />
            </label>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button
              type="button"
              className={`btn btn-sm ${dialog.kind === "decline" ? "btn-danger" : "ds-btn-navy"}`}
              disabled={busy || (dialog.kind !== "accept" && !text.trim())}
              onClick={submit}
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {dialog.kind === "accept" ? "Accept" : dialog.kind === "decline" ? "Decline request" : "Send question"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
