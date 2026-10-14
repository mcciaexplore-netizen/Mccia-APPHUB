import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useApp } from "../App.jsx";
import { api } from "../api.js";
import { PageTitle } from "../components/ui.jsx";
import { fmtDate, fmtDateTime, inr } from "../lib.js";

const Row = ({ label, required, error, children }) => (
  <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:gap-5">
    <label className="pt-1.5 font-bold sm:w-52 sm:shrink-0">{label}{required && <span className="text-red-500"> *</span>}</label>
    <div className="w-full max-w-sm">{children}{error && <p className="mt-1 text-sm text-red-600" role="alert">{error}</p>}</div>
  </div>
);

/** The page that loads the form: for a new request, or for the person answering a "more information" request. */
export default function FormPage() {
  const { module: moduleParam, id: editId } = useParams();
  const { config, toast } = useApp();
  const [detail, setDetail] = useState(null);
  useEffect(() => { if (editId) api("GET", `/api/submissions/${editId}`).then(setDetail).catch((e) => toast("error", e.message)); }, [editId, toast]);
  const moduleKey = editId ? detail?.module : moduleParam;
  if (editId && !detail) return <p className="text-gray-500">Loading…</p>;
  if (!config.modules[moduleKey]) return <p className="text-red-600">That form does not exist.</p>;
  return <FormBody key={`${moduleKey}-${editId ?? "new"}`} moduleKey={moduleKey} detail={detail} editId={editId} />;
}

function FormBody({ moduleKey, detail, editId }) {
  const { user, config, toast } = useApp();
  const nav = useNavigate();
  const mod = config.modules[moduleKey];
  const { lists, threshold } = config;
  const hasBudget = mod.fields.some((f) => f.type === "computed");

  const initial = useMemo(() => {
    const v = {};
    for (const f of mod.fields) {
      if (f.type === "file" || f.type === "computed") continue;
      v[f.key] = detail ? detail.data[f.key] ?? "" : "";
    }
    if (!detail && "name" in v) v.name = lists.employees.find((e) => e.name === user.name)?.id ?? "";
    return v;
  }, [mod, detail, lists, user]);

  const [values, setValues] = useState(initial);
  const [files, setFiles] = useState({});
  const [errors, setErrors] = useState({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [budget, setBudget] = useState(null);
  const [openedAt] = useState(() => new Date().toISOString());
  const set = (k, v) => { setValues((s) => ({ ...s, [k]: v })); setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e)); };

  const branch = values.branch, category = values.category;
  const budgetKey = branch && category ? `${branch}|${category}` : "";
  useEffect(() => {
    if (!hasBudget || !budgetKey) return;
    let live = true;
    api("GET", `/api/budget?branch=${branch}&category=${category}${editId ? `&exclude=${editId}` : ""}`)
      .then((b) => live && setBudget({ key: budgetKey, ...b }))
      .catch(() => {});
    return () => { live = false; };
  }, [hasBudget, budgetKey, branch, category, editId]);

  const amount = values[mod.amountKey] === "" ? null : Number(values[mod.amountKey]);
  const b = budget && budget.key === budgetKey ? budget : null;
  const remaining = b && b.available != null ? b.available - (amount || 0) : null;
  const computed = { allocated: b?.allocated, available: b?.available, remaining, difference: remaining };

  const wrongForm =
    moduleKey === "expenditure" && amount != null && amount >= threshold ? { text: "Amounts of ₹10,000 and above must be submitted through DG Approval: Expenditure.", to: "/new/dg_expenditure" }
    : moduleKey === "dg_expenditure" && amount != null && amount > 0 && amount < threshold ? { text: "Amounts below ₹10,000 must be submitted through the Expenditure form.", to: "/new/expenditure" }
    : null;

  const reset = () => { setValues(initial); setFiles({}); setErrors({}); setNote(""); };

  const submit = async (e) => {
    e.preventDefault();
    const err = {};
    for (const f of mod.fields) {
      if (f.required && (values[f.key] === "" || values[f.key] === undefined)) err[f.key] = `${f.label} is required.`;
      if ((f.type === "money") && values[f.key] !== "" && !(Number(values[f.key]) >= 0)) err[f.key] = `${f.label} must be an amount.`;
    }
    if (wrongForm) err[mod.amountKey] = wrongForm.text;
    setErrors(err);
    if (Object.keys(err).length) { toast("error", Object.values(err)[0]); return; }

    const payload = {};
    for (const f of mod.fields) if (f.type !== "file" && f.type !== "computed") payload[f.key] = values[f.key];
    const fd = new FormData();
    fd.set("payload", JSON.stringify(payload));
    for (const [k, file] of Object.entries(files)) fd.set(k, file);
    if (editId && note) fd.set("note", note);
    setBusy(true);
    try {
      const r = await api(editId ? "PUT" : "POST", editId ? `/api/submissions/${editId}` : `/api/submissions/${moduleKey}`, fd);
      toast("ok", editId ? `Resubmitted ${r.ref_no}` : `Submitted ${r.ref_no}`);
      nav(`/submission/${r.id}`);
    } catch (ex) { toast("error", ex.message); setBusy(false); }
  };

  const options = (f) => {
    const all = lists[f.source] ?? [];
    return f.dependsOn ? all.filter((o) => String(o.publication_type) === String(values[f.dependsOn])) : all;
  };

  const control = (f) => {
    const bad = errors[f.key] ? "!border-red-500" : "";
    switch (f.type) {
      case "text": return <input className={`field ${bad}`} value={values[f.key]} onChange={(e) => set(f.key, e.target.value)} maxLength={200} />;
      case "textarea": return <textarea className={`field !h-24 ${bad}`} value={values[f.key]} onChange={(e) => set(f.key, e.target.value)} maxLength={4000} />;
      case "email":
        return f.auto
          ? <input className="field" readOnly value={lists.employees.find((x) => x.id === Number(values.name))?.email ?? ""} />
          : <input type="email" className={`field ${bad}`} value={values[f.key]} onChange={(e) => set(f.key, e.target.value)} maxLength={200} />;
      case "datetime": return <input className="field" readOnly value={fmtDateTime(detail?.data[f.key] ?? openedAt)} />;
      case "number": return <input type="number" min="0" step="1" className={`field ${bad}`} value={values[f.key]} onChange={(e) => set(f.key, e.target.value)} />;
      case "money":
        return (
          <div className="flex">
            <input inputMode="decimal" type="number" min="0" step="0.01" placeholder="0.00" className={`field rounded-r-none ${bad}`} value={values[f.key]} onChange={(e) => set(f.key, e.target.value)} />
            <span className="grid min-w-9 place-items-center rounded-r border border-l-0 border-gray-300 bg-gray-100 px-2">₹</span>
          </div>
        );
      case "date":
        return (
          <>
            <input type="date" className={`field ${bad}`} value={values[f.key]} max={f.key === "tax_invoice_date" ? new Date().toISOString().slice(0, 10) : undefined} onChange={(e) => set(f.key, e.target.value)} />
            {values[f.key] && <span className="text-xs text-gray-500">{fmtDate(values[f.key])}</span>}
          </>
        );
      case "select":
        return (
          <select className={`field ${bad}`} value={values[f.key]} disabled={f.dependsOn && !values[f.dependsOn]}
            onChange={(e) => { set(f.key, e.target.value); if (f.key === "publication_type") set("publication", ""); }}>
            <option value="">-Select-</option>
            {options(f).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        );
      case "file": {
        const existing = detail?.files.find((x) => x.key === f.key)?.file;
        return (
          <>
            <input type="file" className="field !p-1" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
              onChange={(e) => { const file = e.target.files?.[0]; setFiles((s) => { const n = { ...s }; if (file) n[f.key] = file; else delete n[f.key]; return n; }); }} />
            {existing && !files[f.key] && <p className="mt-1 text-xs text-gray-500">Current file: {existing.original_name} (kept unless you choose another)</p>}
          </>
        );
      }
      case "computed": {
        const n = computed[f.compute];
        const text = !budgetKey ? "" : !b ? "…" : n == null ? "No budget set" : inr(n);
        return <input className={`field ${typeof n === "number" && n < 0 ? "!text-red-600 font-bold" : ""}`} readOnly value={text} placeholder={f.type === "computed" ? "Auto" : ""} />;
      }
      default: return null;
    }
  };

  return (
    <>
      <PageTitle title={editId ? `Resubmit ${detail.ref_no}` : mod.label} />
      <form onSubmit={submit} noValidate className="max-w-3xl">
        {mod.fields.map((f) => (
          <Row key={f.key} label={f.label} required={f.required} error={errors[f.key]}>
            {control(f)}
            {f.key === mod.amountKey && wrongForm && <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">{wrongForm.text} <Link className="font-bold underline" to={wrongForm.to}>Open that form</Link></p>}
          </Row>
        ))}
        {hasBudget && remaining != null && remaining < 0 && (
          <p className="mb-4 max-w-xl rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">This request exceeds the remaining budget by {inr(-remaining)}. You can still submit it.</p>
        )}
        {editId && (
          <Row label="Note to the approver"><textarea className="field !h-20" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} /></Row>
        )}
        <div className="mt-6 flex gap-3 border-t pt-5 sm:pl-[calc(13rem+1.25rem)]">
          <button className="btn btn-primary" disabled={busy || !!wrongForm}>{busy ? "Submitting…" : editId ? "Resubmit" : "Submit"}</button>
          <button type="button" className="btn" onClick={reset} disabled={busy}>Reset</button>
        </div>
      </form>
    </>
  );
}
