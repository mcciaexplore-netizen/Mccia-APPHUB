import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import PageTitle from "../common/PageTitle.jsx";
import FieldControl from "./FieldControl.jsx";
import FormRow from "./FormRow.jsx";
import { ROUTES } from "../../constants/routes.js";
import { useApp } from "../../context/AppContext.jsx";
import { useBudget } from "../../hooks/useBudget.js";
import { createSubmission, resubmitSubmission } from "../../services/submissionService.js";
import { inr } from "../../utils/format.js";
import { validateForm, wrongExpenditureForm } from "../../utils/validators.js";

const isInput = (f) => f.type !== "file" && f.type !== "computed";

/**
 * One request form, drawn from the server's definition of the module (fields, order, which are required). Used for all five forms, for a
 * new request and for answering a "more information" request (`detail` and `editId` set).
 */
export default function RequestForm({ moduleKey, detail, editId }) {
  const { user, config, toast } = useApp();
  const nav = useNavigate();
  const mod = config.modules[moduleKey];
  const { lists, threshold } = config;
  const hasBudget = mod.fields.some((f) => f.type === "computed");

  const initial = useMemo(() => {
    const v = {};
    for (const f of mod.fields.filter(isInput)) v[f.key] = detail ? detail.data[f.key] ?? "" : "";
    if (!detail && "name" in v) v.name = lists.employees.find((e) => e.name === user.name)?.id ?? "";
    return v;
  }, [mod, detail, lists, user]);

  const [values, setValues] = useState(initial);
  const [files, setFiles] = useState({});
  const [errors, setErrors] = useState({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [openedAt] = useState(() => new Date().toISOString());

  const setValue = (k, v) => { setValues((s) => ({ ...s, [k]: v })); setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e)); };
  const setFile = (k, file) => setFiles((s) => { const n = { ...s }; if (file) n[k] = file; else delete n[k]; return n; });

  // The budget the person is spending from follows the branch and category they pick; the rest is arithmetic on the amount typed.
  const { chosen, budget } = useBudget(hasBudget, values.branch, values.category, editId);
  const amount = values[mod.amountKey] === "" ? null : Number(values[mod.amountKey]);
  const remaining = budget && budget.available != null ? budget.available - (amount || 0) : null;
  const computed = { allocated: budget?.allocated, available: budget?.available, remaining, difference: remaining };
  const computedText = (f) => {
    const n = computed[f.compute];
    return { text: !chosen ? "" : !budget ? "…" : n == null ? "No budget set" : inr(n), negative: typeof n === "number" && n < 0 };
  };
  const wrongForm = wrongExpenditureForm(moduleKey, amount, threshold);
  const employeeEmail = lists.employees.find((x) => x.id === Number(values.name))?.email ?? "";

  const reset = () => { setValues(initial); setFiles({}); setErrors({}); setNote(""); };

  const submit = async (e) => {
    e.preventDefault();
    const found = validateForm(mod, values, wrongForm);
    setErrors(found);
    if (Object.keys(found).length) { toast("error", Object.values(found)[0]); return; }

    const payload = {};
    for (const f of mod.fields.filter(isInput)) payload[f.key] = values[f.key];
    const body = new FormData();
    body.set("payload", JSON.stringify(payload));
    for (const [k, file] of Object.entries(files)) body.set(k, file);
    if (editId && note) body.set("note", note);

    setBusy(true);
    try {
      const r = editId ? await resubmitSubmission(editId, body) : await createSubmission(moduleKey, body);
      toast("ok", editId ? `Resubmitted ${r.ref_no}` : `Submitted ${r.ref_no}`);
      nav(ROUTES.submission(r.id));
    } catch (ex) {
      toast("error", ex.message);
      setBusy(false);
    }
  };

  return (
    <>
      <PageTitle title={editId ? `Resubmit ${detail.ref_no}` : mod.label} />
      <form onSubmit={submit} noValidate className="max-w-3xl">
        {mod.fields.map((f) => (
          <FormRow key={f.key} label={f.label} required={f.required} error={errors[f.key]}>
            <FieldControl
              field={f} value={values[f.key]} values={values} setValue={setValue} error={errors[f.key]} lists={lists}
              files={files} setFile={setFile} detail={detail} openedAt={openedAt}
              computedText={f.type === "computed" ? computedText(f) : null} employeeEmail={employeeEmail}
            />
            {f.key === mod.amountKey && wrongForm && (
              <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
                {wrongForm.text} <Link className="font-bold underline" to={wrongForm.to}>Open that form</Link>
              </p>
            )}
          </FormRow>
        ))}
        {hasBudget && remaining != null && remaining < 0 && (
          <p className="mb-4 max-w-xl rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">This request exceeds the remaining budget by {inr(-remaining)}. You can still submit it.</p>
        )}
        {editId && (
          <FormRow label="Note to the approver"><textarea className="field !h-20" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} /></FormRow>
        )}
        <div className="mt-6 flex gap-3 border-t pt-5 sm:pl-[calc(13rem+1.25rem)]">
          <button className="btn btn-primary" disabled={busy || !!wrongForm}>{busy ? "Submitting…" : editId ? "Resubmit" : "Submit"}</button>
          <button type="button" className="btn" onClick={reset} disabled={busy}>Reset</button>
        </div>
      </form>
    </>
  );
}
