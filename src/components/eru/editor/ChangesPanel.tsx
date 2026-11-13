"use client";

import { Check, X } from "lucide-react";
import type { ChangeInfo } from "@/lib/eru/editor/track-changes";
import { Avatar, formatDateTime } from "../ui";

/**
 * Every pending tracked change, in document order: who made it, what it inserts or deletes, when. ERU admins accept (green) or reject (red)
 * one at a time or all at once; everyone else sees what is waiting for review.
 */
export function ChangesPanel({
  changes,
  admin,
  busy,
  active,
  onFocus,
  onDecide,
}: {
  changes: ChangeInfo[];
  admin: boolean;
  busy: boolean;
  active: string | null;
  onFocus: (c: ChangeInfo) => void;
  onDecide: (ids: string[] | null, decision: "accept" | "reject") => void;
}) {
  return (
    <div className="flex flex-col gap-3" aria-label="Tracked changes">
      {admin && changes.length > 0 && (
        <div className="flex gap-2">
          <button type="button" className="btn eru-btn-green btn-sm flex-1" disabled={busy} onClick={() => onDecide(null, "accept")}>
            <Check size={14} aria-hidden /> Accept all
          </button>
          <button type="button" className="btn eru-btn-red btn-sm flex-1" disabled={busy} onClick={() => onDecide(null, "reject")}>
            <X size={14} aria-hidden /> Reject all
          </button>
        </div>
      )}
      {!admin && changes.length > 0 && <p className="text-xs eru-muted">An ERU admin accepts or rejects these.</p>}
      {changes.length ? (
        <ul className="flex flex-col gap-2">
          {changes.map((c) => (
            <li
              key={`${c.type}:${c.id}`}
              className="eru-card eru-comment-card flex cursor-pointer flex-col gap-1.5 p-3"
              data-active={active === c.id}
              data-testid="eru-change"
              onClick={() => onFocus(c)}
            >
              <header className="flex items-center gap-2">
                <Avatar name={c.userName || "?"} size={24} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.8rem] font-bold text-ink">{c.userName || "Someone"}</span>
                  <span className="block text-[0.68rem] eru-muted">
                    {c.type === "insertion" ? "Inserted" : "Deleted"}
                    {c.at ? `, ${formatDateTime(c.at)}` : ""}
                  </span>
                </span>
                {admin && (
                  <span className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="eru-tool text-[var(--eru-green)]" aria-label="Accept change" title="Accept" disabled={busy} onClick={() => onDecide([c.id], "accept")}>
                      <Check size={15} aria-hidden />
                    </button>
                    <button type="button" className="eru-tool text-[var(--eru-red)]" aria-label="Reject change" title="Reject" disabled={busy} onClick={() => onDecide([c.id], "reject")}>
                      <X size={15} aria-hidden />
                    </button>
                  </span>
                )}
              </header>
              <p className={`line-clamp-3 break-words text-[0.85rem] ${c.type === "insertion" ? "text-[#15803d] underline" : "text-[#b91c1c] line-through"}`}>{c.text.trim() || "(spaces)"}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-[var(--eru-line)] p-4 text-center text-sm eru-muted">No tracked changes waiting.</p>
      )}
    </div>
  );
}
