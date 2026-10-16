"use client";

import { useState } from "react";
import { api, useAction } from "@/components/approvals/api";
import { useConfirm } from "@/components/ConfirmDialog";
import { MODE_WORDS, type DecisionMode } from "@/lib/approvals/calc";

/** Approve, Return for corrections and Reject, with a comment box. A comment is required to reject or return, and to approve a request that is over budget. */
export function DecisionPanel({ id, commentToApprove, mode }: { id: string; commentToApprove: boolean; mode: DecisionMode }) {
  const words = MODE_WORDS[mode];
  const { run, pending } = useAction();
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const decide = (action: "approve" | "reject" | "return") => {
    if (!comment.trim() && (action !== "approve" || commentToApprove)) {
      setError(
        action === "reject" ? "Please write a comment explaining why you are rejecting this request."
          : action === "return" ? "Please write a comment saying what needs to be corrected."
            : "This request is over budget, so a comment is required to approve it.",
      );
      return;
    }
    setError(null);
    run(() => api("POST", `/api/approvals/requests/${id}/decision`, { action, comment }), action === "approve" ? words.done : action === "reject" ? "Request rejected" : "Request returned for corrections");
  };

  return (
    <section className="glass max-w-3xl space-y-3 p-4" aria-label="Your decision">
      <h2>Your decision</h2>
      {commentToApprove && <p className="apr-notice apr-notice-red">This request is over budget. You can still approve it, but you must write a comment first.</p>}
      <label className="block">
        <span className="label-xs mb-1.5 block">Comments{commentToApprove ? " (required to approve, return or reject)" : " (required to return or reject)"}</span>
        <textarea className="input !h-24 w-full" value={comment} onChange={(e) => { setComment(e.target.value); setError(null); }} maxLength={2000} />
      </label>
      {error && <p className="zf-error" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary" disabled={pending} onClick={() => decide("approve")}>{words.approve}</button>
        <button type="button" className="btn btn-ghost" disabled={pending} onClick={() => decide("return")}>Return for corrections</button>
        <button type="button" className="btn btn-danger" disabled={pending} onClick={() => decide("reject")}>{words.reject}</button>
      </div>
    </section>
  );
}

/** The requester can take a pending request back. */
export function WithdrawButton({ id }: { id: string }) {
  const { run, pending } = useAction();
  const confirm = useConfirm();
  const withdraw = async () => {
    if (!(await confirm({ title: "Withdraw this request?", message: "It will no longer wait for anyone. You can raise a new request if you change your mind.", confirmLabel: "Withdraw", danger: true }))) return;
    run(() => api("POST", `/api/approvals/requests/${id}/withdraw`, {}), "Request withdrawn");
  };
  return <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={withdraw}>Withdraw request</button>;
}
