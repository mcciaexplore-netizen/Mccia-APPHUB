"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, RotateCcw, Trash2 } from "lucide-react";
import type { CommentView } from "@/lib/eru/queries";
import { Avatar, formatDateTime } from "../ui";

export type Draft = { from: number; to: number; quote: string; top: number };

type Props = {
  comments: CommentView[];
  /** Where each comment's text is, as a distance from the top of the page (px); missing: its text was removed. */
  tops: Record<string, number>;
  /** Line the cards up beside their text (wide screens), or list them (narrow ones). */
  aligned: boolean;
  height: number;
  active: string | null;
  draft: Draft | null;
  me: { id: string; admin: boolean };
  busy: boolean;
  onActivate: (id: string) => void;
  onSubmitDraft: (text: string) => void;
  onCancelDraft: () => void;
  onResolve: (id: string, resolved: boolean) => void;
  onDelete: (id: string) => void;
};

const GAP = 8;

/**
 * The comments beside the page. Open comments line up with their text (pushed down so they never overlap); comments whose text was deleted
 * follow at the end; resolved ones are folded away under "Resolved".
 */
export function CommentsPanel(p: Props) {
  const open = p.comments.filter((c) => !c.resolved);
  const resolved = p.comments.filter((c) => c.resolved);
  const placed = open.filter((c) => p.tops[c.id] !== undefined).sort((a, b) => p.tops[a.id] - p.tops[b.id]);
  const orphans = open.filter((c) => p.tops[c.id] === undefined);
  const box = useRef<HTMLDivElement>(null);
  const [showResolved, setShowResolved] = useState(false);

  // Lines the cards up beside their text, top to bottom, each pushed down below the one before so none overlap. Done on the DOM after
  // every render (cheap: a handful of cards), since it depends on the cards' rendered heights.
  const order = [...(p.draft ? [{ id: "__draft", top: p.draft.top }] : []), ...placed.map((c) => ({ id: c.id, top: p.tops[c.id] }))].sort((a, b) => a.top - b.top);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !p.aligned) return;
    let bottom = 0;
    for (const o of order) {
      const card = el.querySelector<HTMLElement>(`[data-cid="${o.id}"]`);
      if (!card) continue;
      const top = Math.max(o.top, bottom);
      card.style.top = `${top}px`;
      bottom = top + card.offsetHeight + GAP;
    }
    el.style.minHeight = `${Math.max(p.height, bottom + 20)}px`;
  });

  const style = (id: string): React.CSSProperties | undefined => (p.aligned ? { position: "absolute", top: p.tops[id] ?? 0, left: 0, right: 0 } : undefined);

  return (
    <div className="flex flex-col gap-3" aria-label="Comments">
      <div ref={box} className={p.aligned ? "relative" : "flex flex-col gap-2"}>
        {p.draft && (
          <form
            data-cid="__draft"
            style={p.aligned ? { position: "absolute", top: p.draft.top, left: 0, right: 0 } : undefined}
            className="eru-card eru-comment-card flex flex-col gap-2 p-3"
            data-active="true"
            onSubmit={(e) => {
              e.preventDefault();
              const text = String(new FormData(e.currentTarget).get("text") ?? "");
              if (text.trim()) p.onSubmitDraft(text);
            }}
          >
            <p className="line-clamp-2 border-l-2 border-[#eab308] pl-2 text-xs italic eru-muted">{p.draft.quote}</p>
            <textarea
              name="text"
              className="input text-sm"
              rows={3}
              maxLength={4000}
              placeholder="Add a comment…"
              aria-label="Comment"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
                if (e.key === "Escape") p.onCancelDraft();
              }}
            />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={p.onCancelDraft}>
                Cancel
              </button>
              <button type="submit" className="btn eru-btn-navy btn-sm" disabled={p.busy}>
                Comment
              </button>
            </div>
          </form>
        )}
        {placed.map((c) => (
          <CommentCard key={c.id} c={c} p={p} style={style(c.id)} />
        ))}
        {!p.draft && !open.length && <p className="rounded-lg border border-dashed border-[var(--eru-line)] p-4 text-center text-sm eru-muted">No open comments. Select text and choose Add comment.</p>}
      </div>
      {orphans.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="eru-label">Text removed</p>
          {orphans.map((c) => (
            <CommentCard key={c.id} c={c} p={p} />
          ))}
        </div>
      )}
      {resolved.length > 0 && (
        <div className="flex flex-col gap-2">
          <button type="button" className="flex items-center gap-1 text-left eru-label" aria-expanded={showResolved} onClick={() => setShowResolved((v) => !v)}>
            <ChevronDown size={13} className={showResolved ? "" : "-rotate-90"} aria-hidden /> Resolved ({resolved.length})
          </button>
          {showResolved && resolved.map((c) => <CommentCard key={c.id} c={c} p={p} />)}
        </div>
      )}
    </div>
  );
}

function CommentCard({ c, p, style }: { c: CommentView; p: Props; style?: React.CSSProperties }) {
  const mine = c.userId === p.me.id;
  return (
    <article
      data-cid={c.id}
      style={style}
      className={`eru-card eru-comment-card flex cursor-pointer flex-col gap-1.5 p-3 ${c.resolved ? "opacity-70" : ""}`}
      data-active={p.active === c.id}
      data-testid="eru-comment"
      onClick={() => p.onActivate(c.id)}
    >
      <header className="flex items-center gap-2">
        <Avatar name={c.userName} size={24} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.8rem] font-bold text-ink">{c.userName}</span>
          <span className="block text-[0.68rem] eru-muted">{formatDateTime(c.createdAt)}</span>
        </span>
        {(mine || p.me.admin) && (
          <span className="flex gap-0.5" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="eru-tool" title={c.resolved ? "Reopen" : "Resolve"} aria-label={c.resolved ? "Reopen comment" : "Resolve comment"} disabled={p.busy} onClick={() => p.onResolve(c.id, !c.resolved)}>
              {c.resolved ? <RotateCcw size={14} aria-hidden /> : <Check size={14} aria-hidden />}
            </button>
            <button type="button" className="eru-tool" title="Delete" aria-label="Delete comment" disabled={p.busy} onClick={() => p.onDelete(c.id)}>
              <Trash2 size={13} aria-hidden />
            </button>
          </span>
        )}
      </header>
      {c.quote && <p className="line-clamp-2 border-l-2 border-[#eab308] pl-2 text-xs italic eru-muted">{c.quote}</p>}
      <p className="whitespace-pre-wrap text-[0.85rem] text-ink">{c.content}</p>
      {c.resolved && c.resolvedByName && <p className="text-[0.68rem] eru-muted">Resolved by {c.resolvedByName}</p>}
    </article>
  );
}
