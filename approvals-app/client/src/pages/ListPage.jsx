import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useApp } from "../App.jsx";
import { api } from "../api.js";
import { StatusBadge, PageTitle } from "../components/ui.jsx";
import { fmtDate, inr } from "../lib.js";

const VIEW_TITLE = { mine: "My Submissions", pending: "Pending", approved: "Approved", rejected: "Rejected", history: "Full History" };

export default function ListPage() {
  const { user, config } = useApp();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const view = params.get("view") ?? "mine";
  const modules = params.get("modules") ?? "";
  const q = params.get("q") ?? "";
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [text, setText] = useState(q);
  const timer = useRef();

  useEffect(() => {
    let live = true;
    setRows(null);
    api("GET", `/api/submissions?view=${view}&modules=${modules}&q=${encodeURIComponent(q)}`)
      .then((r) => live && setRows(r))
      .catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [view, modules, q]);

  const typed = (v) => {
    setText(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set("q", v); else n.delete("q"); return n; }, { replace: true }), 300);
  };

  const mods = modules.split(",").filter((m) => config.modules[m]);
  const title = `${VIEW_TITLE[view] ?? "Requests"}${mods.length === 1 ? `: ${config.modules[mods[0]].label}` : mods.length ? `: ${mods.map((m) => config.modules[m].short).join(" and ")}` : ""}`;

  return (
    <>
      <PageTitle title={title}>
        {view === "mine" && user.role === "staff" && mods.map((m) => (
          <Link key={m} to={`/new/${m}`} className="btn btn-primary">+ {config.modules[m].short}{m === "expenditure" ? " (below ₹10,000)" : m === "dg_expenditure" ? " (₹10,000 and above)" : ""}</Link>
        ))}
      </PageTitle>
      <input className="field mb-4 max-w-xs" type="search" placeholder="Search" aria-label="Search" value={text} onChange={(e) => typed(e.target.value)} />
      {error && <p className="text-red-600" role="alert">{error}</p>}
      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full text-left">
          <thead className="bg-gray-50 text-xs text-gray-600">
            <tr>{["Ref", "Type", "Details", "Submitted by", "Amount", "Updated", "Status", "With"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows === null && !error && <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-500">Loading…</td></tr>}
            {rows?.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-500">Nothing here yet.</td></tr>}
            {rows?.map((r) => (
              <tr key={r.id} onClick={() => nav(`/submission/${r.id}`)} className="cursor-pointer border-t border-gray-100 hover:bg-gray-50">
                <td className="whitespace-nowrap px-3 py-2 font-bold"><Link to={`/submission/${r.id}`} className="text-brand-dark hover:underline" onClick={(e) => e.stopPropagation()}>{r.ref_no}</Link></td>
                <td className="px-3 py-2">{r.module_label}</td>
                <td className="px-3 py-2">{r.summary}</td>
                <td className="px-3 py-2">{r.submitter}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">{r.amount == null ? "" : inr(r.amount)}</td>
                <td className="whitespace-nowrap px-3 py-2">{fmtDate(r.updated_at)}</td>
                <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                <td className="px-3 py-2">{r.status === "Pending" ? r.current_approver : r.status === "More Info Required" ? r.submitter : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
