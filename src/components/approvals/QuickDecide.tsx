"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { api, useAction } from "@/components/approvals/api";

/** Approve and Reject right from a list. A comment is always asked for before rejecting, and before approving something over budget. */
export function QuickDecide({ id, label, overBudget }: { id: string; label: string; overBudget: boolean }) {
  const { run, pending } = useAction();
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [comment, setComment] = useState("");
  const needed = mode === "reject" || (mode === "approve" && overBudget);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mode) return;
    run(() => api("POST", `/api/approvals/requests/${id}/decision`, { action: mode, comment }), mode === "approve" ? "Request approved" : "Request rejected", () => { setMode(null); setComment(""); });
  };

  return (
    <>
      <span className="inline-flex gap-1.5">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setMode("approve")}>Approve</button>
        <button type="button" className="btn btn-danger btn-sm" onClick={() => setMode("reject")}>Reject</button>
      </span>
      {/* The dialog sits inside a clickable table row; clicks inside it must not reach the row (which would open the request). */}
      {mode && (
        <div onClick={(e) => e.stopPropagation()}>
        <Modal title={`${mode === "approve" ? "Approve" : "Reject"} ${label}`} onClose={() => setMode(null)}>
          <form onSubmit={submit} className="space-y-4">
            {mode === "approve" && overBudget && <p className="apr-notice">This request is over budget, so a comment is required to approve it.</p>}
            <label className="block">
              <span className="label-xs mb-1.5 block">Comment{needed ? " *" : ""}</span>
              <textarea className="input !h-24 w-full" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} required={needed} autoFocus />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode(null)}>Cancel</button>
              <button className={`btn btn-sm ${mode === "approve" ? "btn-primary" : "btn-danger"}`} disabled={pending || (needed && !comment.trim())}>
                {mode === "approve" ? "Approve" : "Reject"}
              </button>
            </div>
          </form>
        </Modal>
        </div>
      )}
    </>
  );
}
