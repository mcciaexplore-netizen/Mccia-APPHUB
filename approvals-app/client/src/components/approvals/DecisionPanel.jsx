import { useState } from "react";

/** Approve, Reject and Request More Info with a comment box. A comment is needed to reject or to ask for more information. */
export default function DecisionPanel({ busy, onDecide, onInvalid }) {
  const [comment, setComment] = useState("");
  const decide = (action) => {
    if ((action === "reject" || action === "more_info") && !comment.trim()) {
      onInvalid(action === "reject" ? "Please write the reason for rejecting." : "Please say what information is needed.");
      return;
    }
    onDecide(action, comment, () => setComment(""));
  };
  return (
    <section className="mb-8 max-w-2xl rounded border border-gray-200 p-4" aria-label="Your decision">
      <h2 className="mb-2 text-base font-bold">Your decision</h2>
      <textarea className="field mb-3 !h-24" placeholder="Comment (required to reject or ask for more information)" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} />
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={busy} onClick={() => decide("approve")}>Approve</button>
        <button className="btn btn-danger" disabled={busy} onClick={() => decide("reject")}>Reject</button>
        <button className="btn btn-info" disabled={busy} onClick={() => decide("more_info")}>Request More Info</button>
      </div>
    </section>
  );
}
