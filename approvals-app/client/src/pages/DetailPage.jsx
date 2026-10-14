import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp } from "../App.jsx";
import { api } from "../api.js";
import { PageTitle, StatusBadge } from "../components/ui.jsx";
import { fmtDate, fmtDateTime, inr } from "../lib.js";

const showValue = (f) => {
  if (f.type === "money" || f.type === "computed") return typeof f.value === "number" ? inr(f.value) : f.value === null ? "Not set" : f.value;
  if (f.type === "date") return fmtDate(f.value);
  if (f.type === "datetime") return fmtDateTime(f.value);
  return f.value;
};

export default function DetailPage() {
  const { id } = useParams();
  const { toast } = useApp();
  const [d, setD] = useState(null);
  const [error, setError] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api("GET", `/api/submissions/${id}`).then(setD).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  const act = async (action) => {
    if ((action === "reject" || action === "more_info") && !comment.trim()) {
      toast("error", action === "reject" ? "Please write the reason for rejecting." : "Please say what information is needed.");
      return;
    }
    setBusy(true);
    try {
      await api("POST", `/api/submissions/${id}/action`, { action, comment });
      toast("ok", action === "approve" ? "Approved" : action === "reject" ? "Rejected" : "More information requested");
      setComment("");
      await load();
    } catch (e) { toast("error", e.message); await load(); }
    setBusy(false);
  };

  if (error) return <p className="text-red-600" role="alert">{error}</p>;
  if (!d) return <p className="text-gray-500">Loading…</p>;
  const lastInfo = [...d.audit].reverse().find((a) => a.action === "Requested more information");

  return (
    <>
      <PageTitle title={`${d.ref_no}: ${d.module_label}`}><StatusBadge status={d.status} /></PageTitle>

      {d.can.resubmit && (
        <div className="mb-6 max-w-2xl rounded border border-blue-300 bg-blue-50 p-4 text-blue-900">
          <p className="font-bold">More information was requested</p>
          {lastInfo && <p className="mt-1 whitespace-pre-wrap">&ldquo;{lastInfo.comment}&rdquo; ({lastInfo.actor_name})</p>}
          <Link to={`/edit/${d.id}`} className="btn btn-primary mt-3">Edit and resubmit</Link>
        </div>
      )}

      {d.can.act && (
        <section className="mb-8 max-w-2xl rounded border border-gray-200 p-4" aria-label="Your decision">
          <h2 className="mb-2 text-base font-bold">Your decision</h2>
          <textarea className="field mb-3 !h-24" placeholder="Comment (required to reject or ask for more information)" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} />
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={busy} onClick={() => act("approve")}>Approve</button>
            <button className="btn btn-danger" disabled={busy} onClick={() => act("reject")}>Reject</button>
            <button className="btn btn-info" disabled={busy} onClick={() => act("more_info")}>Request More Info</button>
          </div>
        </section>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm">
        {d.stages.map((s, i) => (
          <span key={s.username} className="flex items-center gap-2">
            {i > 0 && <span className="text-gray-400">→</span>}
            <span className={`rounded-full border px-3 py-1 ${s.state === "done" ? "border-green-300 bg-green-50 text-green-800" : s.state === "current" ? "border-yellow-300 bg-yellow-50 text-yellow-800" : s.state === "rejected" ? "border-red-300 bg-red-50 text-red-800" : "border-gray-200 text-gray-500"}`}>
              {s.name} {s.state === "done" ? "✓" : ""}
            </span>
          </span>
        ))}
      </div>

      <dl className="mb-8 grid max-w-3xl gap-x-6 gap-y-3 sm:grid-cols-[13rem_1fr]">
        <dt className="font-bold">Submitted by</dt><dd>{d.submitter}</dd>
        {d.fields.map((f) => (<div key={f.key} className="contents"><dt className="font-bold">{f.label}</dt><dd className="whitespace-pre-wrap break-words">{showValue(f) || "—"}</dd></div>))}
        {d.files.map((f) => (
          <div key={f.key} className="contents">
            <dt className="font-bold">{f.label}</dt>
            <dd>{f.file ? <a className="text-brand-dark underline" href={`/api/files/${f.file.id}`}>{f.file.original_name}</a> : "—"}</dd>
          </div>
        ))}
      </dl>

      <h2 className="mb-3 text-base font-bold">Audit trail</h2>
      <ol className="max-w-2xl space-y-3 border-l-2 border-gray-200 pl-5">
        {d.audit.map((a, i) => (
          <li key={i}>
            <p className="font-bold">{a.action} <span className="font-normal text-gray-600">by {a.actor_name}</span></p>
            <p className="text-xs text-gray-500">{fmtDateTime(a.created_at)}</p>
            {a.comment && <p className="mt-1 whitespace-pre-wrap">&ldquo;{a.comment}&rdquo;</p>}
          </li>
        ))}
      </ol>
    </>
  );
}
