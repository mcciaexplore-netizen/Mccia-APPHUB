"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, MessageSquareWarning } from "lucide-react";
import { decideReview } from "@/lib/design/actions/review";

/** Approve (after an "Are you sure?") or ask for changes (with a required note). Each can be done once; the result replaces the buttons. */
export function ReviewDecision({ token, expiresAt }: { token: string; expiresAt: string }) {
  const [mode, setMode] = useState<"choose" | "confirm" | "changes">("choose");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"approved" | "changes" | null>(null);
  const [pending, start] = useTransition();

  const decide = (decision: "approve" | "request_changes") =>
    start(async () => {
      setError(null);
      const res = await decideReview(token, decision, decision === "approve" ? "" : comment);
      if (res.ok) setDone(decision === "approve" ? "approved" : "changes");
      else setError(res.error);
    });

  if (done)
    return (
      <div className="ds-card flex flex-col items-center gap-3 px-6 py-10 text-center">
        {done === "approved" ? <CheckCircle2 size={44} className="text-[var(--ds-green)]" aria-hidden /> : <MessageSquareWarning size={44} className="text-[var(--ds-navy)]" aria-hidden />}
        <h2 className="text-xl font-bold text-ink" role="status">
          {done === "approved" ? "Design approved! The team has been notified." : "Changes requested. The team will get back to you."}
        </h2>
      </div>
    );

  return (
    <div className="ds-card flex flex-col gap-3 p-5">
      {mode === "choose" && (
        <>
          <button type="button" className="btn ds-btn-green w-full justify-center py-3 text-base" onClick={() => setMode("confirm")}>
            ✓ Approve this design
          </button>
          <button type="button" className="btn ds-btn-outline-red w-full justify-center py-3 text-base" onClick={() => setMode("changes")}>
            ✗ Request changes
          </button>
        </>
      )}
      {mode === "confirm" && (
        <div className="flex flex-col gap-3 text-center">
          <p className="text-base font-semibold text-ink">Are you sure? Approving tells the team this design is final.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" className="btn ds-btn-green flex-1 justify-center py-3" disabled={pending} onClick={() => decide("approve")}>
              {pending ? "Approving…" : "Yes, approve it"}
            </button>
            <button type="button" className="btn btn-ghost flex-1 justify-center py-3" disabled={pending} onClick={() => setMode("choose")}>
              Go back
            </button>
          </div>
        </div>
      )}
      {mode === "changes" && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!comment.trim()) return setError("Please describe what needs to change.");
            decide("request_changes");
          }}
        >
          <label htmlFor="changes" className="text-sm font-semibold text-ink">
            What needs to change?
          </label>
          <textarea id="changes" className="input min-h-32" required maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="submit" className="btn ds-btn-navy flex-1 justify-center py-3" disabled={pending}>
              {pending ? "Sending…" : "Submit"}
            </button>
            <button type="button" className="btn btn-ghost flex-1 justify-center py-3" disabled={pending} onClick={() => setMode("choose")}>
              Go back
            </button>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-[var(--ds-red)]">
          {error}
        </p>
      )}
      <p className="text-center text-xs ds-muted">This link works until {expiresAt} IST.</p>
    </div>
  );
}
