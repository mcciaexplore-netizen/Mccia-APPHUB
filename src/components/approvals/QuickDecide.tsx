"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { MODE_WORDS, type DecisionMode } from "@/lib/approvals/calc";
import { api, useAction } from "@/components/approvals/api";

/**
 * Approve (or Recommend to the DG, or Final approve: see `kind`), Return and Reject right from a list. A comment is always asked for before
 * rejecting or returning, and before approving something over budget.
 */
export function QuickDecide({ id, label, overBudget, kind }: { id: string; label: string; overBudget: boolean; kind: DecisionMode }) {
  const words = MODE_WORDS[kind];
  const { run, pending } = useAction();
  const [mode, setMode] = useState<"approve" | "reject" | "return" | null>(null);
  const [comment, setComment] = useState("");
  const needed = mode === "reject" || mode === "return" || (mode === "approve" && overBudget);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mode) return;
    run(() => api("POST", `/api/approvals/requests/${id}/decision`, { action: mode, comment }), mode === "approve" ? words.done : mode === "reject" ? "Request rejected" : "Request returned for corrections", () => { setMode(null); setComment(""); });
  };

  return (
    <>
      <span className="inline-flex gap-1.5">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setMode("approve")}>{words.approve}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode("return")}>Return</button>
        <button type="button" className="btn btn-danger btn-sm" onClick={() => setMode("reject")}>{words.reject}</button>
      </span>
      {/* The dialog sits inside a clickable table row; clicks inside it must not reach the row (which would open the request). */}
      {mode && (
        <div onClick={(e) => e.stopPropagation()}>
        <Modal title={`${mode === "approve" ? words.approve : mode === "return" ? "Return for corrections:" : words.reject} ${label}`} onClose={() => setMode(null)}>
          <form onSubmit={submit} className="space-y-4">
            {mode === "approve" && overBudget && <p className="apr-notice">This request is over budget, so a comment is required to approve it.</p>}
            <label className="block">
              <span className="label-xs mb-1.5 block">Comment{needed ? " *" : ""}</span>
              <textarea className="input !h-24 w-full" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} required={needed} autoFocus />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode(null)}>Cancel</button>
              <button className={`btn btn-sm ${mode === "approve" ? "btn-primary" : mode === "return" ? "btn-ghost" : "btn-danger"}`} disabled={pending || (needed && !comment.trim())}>
                {mode === "approve" ? words.approve : mode === "return" ? "Return" : words.reject}
              </button>
            </div>
          </form>
        </Modal>
        </div>
      )}
    </>
  );
}
