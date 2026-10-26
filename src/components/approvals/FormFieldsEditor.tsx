"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useToast } from "@/components/Toast";
import { api } from "@/components/approvals/api";
import {
  CUSTOM_KINDS, FORM_KEYS, FORM_TITLE, KIND_LABEL, MAX_FIELDS_PER_FORM, MAX_LABEL, type CustomKind, type FormField, type FormKey,
} from "@/lib/approvals/form-fields";

/** One line of the editor. An extra field that is not saved yet has no key. */
type Line = { id: string; key: string | null; label: string; builtin: boolean; hideable: boolean; hidden: boolean; kind: CustomKind | null; required: boolean; optionsText: string };

const toLine = (f: FormField): Line => ({ id: f.key, key: f.key, label: f.label, builtin: f.builtin, hideable: f.hideable, hidden: f.hidden, kind: f.kind, required: f.required, optionsText: f.options.join("\n") });
const optionsOf = (t: string) => t.split("\n").map((o) => o.trim()).filter(Boolean);
const signature = (lines: Line[]) => JSON.stringify(lines.map((l) => [l.key, l.label, l.hidden, l.kind, l.required, l.optionsText]));
let counter = 0;

/**
 * Where the Support Admin changes the forms everyone uses to raise a request: rename a field, move it up or down, hide the ones that are
 * optional, and add fields of their own (short text, long text, number, date or a dropdown), which can be required. Saving applies at once
 * to the next person who opens the form. Requests already sent keep what was answered, under the name it had.
 */
export function FormFieldsEditor({ initial, forms = FORM_KEYS, title = "Approval Forms", intro }: {
  initial: Record<FormKey, FormField[]>;
  /** Which forms this page edits (HR alone, or the expense form's two layouts); tabs are shown when there is more than one. */ forms?: readonly FormKey[];
  title?: string; intro?: string;
}) {
  const toast = useToast();
  const [form, setForm] = useState<FormKey>(forms[0]);
  const [saved, setSaved] = useState<Record<FormKey, Line[]>>(() => Object.fromEntries(FORM_KEYS.map((k) => [k, initial[k].map(toLine)])) as Record<FormKey, Line[]>);
  const [lines, setLines] = useState<Record<FormKey, Line[]>>(saved);
  const [saving, setSaving] = useState(false);
  const [add, setAdd] = useState<{ label: string; kind: CustomKind; required: boolean; optionsText: string }>({ label: "", kind: "text", required: false, optionsText: "" });

  const mine = lines[form];
  const dirty = signature(mine) !== signature(saved[form]);
  const extraCount = mine.filter((l) => !l.builtin).length;
  const set = (next: Line[]) => setLines((s) => ({ ...s, [form]: next }));
  const patch = (id: string, p: Partial<Line>) => set(mine.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const move = (i: number, d: -1 | 1) => { const next = [...mine]; const j = i + d; if (j < 0 || j >= next.length) return; [next[i], next[j]] = [next[j], next[i]]; set(next); };

  const addField = () => {
    const label = add.label.trim();
    if (!label) return toast.error("Give the new field a name.");
    if (add.kind === "select" && optionsOf(add.optionsText).length === 0) return toast.error("A dropdown needs at least one choice, one per line.");
    set([...mine, { id: `new-${++counter}`, key: null, label, builtin: false, hideable: false, hidden: false, kind: add.kind, required: add.required, optionsText: add.kind === "select" ? add.optionsText : "" }]);
    setAdd({ label: "", kind: "text", required: false, optionsText: "" });
  };

  const save = async () => {
    setSaving(true);
    const r = await api<{ fields: FormField[] }>("PUT", `/api/approvals/form-fields/${form}`, {
      fields: mine.map((l) => ({ key: l.key, label: l.label, hidden: l.hidden, kind: l.builtin ? undefined : l.kind ?? "text", required: l.required, options: l.kind === "select" ? optionsOf(l.optionsText) : [] })),
    });
    setSaving(false);
    if (!r.ok) return toast.error(r.error);
    const fresh = r.data.fields.map(toLine);
    setSaved((s) => ({ ...s, [form]: fresh }));
    set(fresh);
    toast.success(`${FORM_TITLE[form]} saved`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl">{title}</h2>
        {intro && <p className="mt-1 max-w-3xl text-sm text-muted">{intro}</p>}
        <p className="mt-1 max-w-3xl text-sm text-muted">The forms everyone uses to raise a request. Edit the name of a field by typing in its box, move it up or down, remove the ones that are optional (and restore them later), or add fields of your own. A saved change shows the next time someone opens the form. Requests already sent keep what was answered.</p>
      </div>

      {forms.length > 1 && <div role="tablist" aria-label="Forms" className="flex flex-wrap gap-2 border-b border-line pb-3">
        {forms.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={form === k} onClick={() => setForm(k)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${form === k ? "bg-blue-tint text-primary" : "text-muted hover:bg-blue-tint hover:text-primary"}`}>
            {FORM_TITLE[k]}{signature(lines[k]) !== signature(saved[k]) ? " •" : ""}
          </button>
        ))}
      </div>}

      <ol className="space-y-2" aria-label={`Fields of the ${FORM_TITLE[form]}`}>
        {mine.map((l, i) => (
          <li key={l.id} className={`glass !rounded-md p-3 ${l.hidden ? "opacity-60" : ""}`}>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex gap-1">
                <button type="button" className="btn btn-ghost btn-sm" aria-label={`Move ${l.label} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></button>
                <button type="button" className="btn btn-ghost btn-sm" aria-label={`Move ${l.label} down`} disabled={i === mine.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></button>
              </div>
              <input className="input !w-auto min-w-56 flex-1" value={l.label} maxLength={MAX_LABEL} aria-label={`Name of field ${i + 1}`} onChange={(e) => patch(l.id, { label: e.target.value })} />
              <span className={`badge ${l.builtin ? "badge-neutral" : "badge-green"}`}>{l.builtin ? "Built in" : KIND_LABEL[l.kind ?? "text"]}</span>
              {l.builtin ? (
                // A built-in field is taken off the form (and can be put back), never deleted: the request still has a place for it.
                !l.hideable ? <span className="text-xs text-subtle">Always on the form: the request needs it</span>
                  : l.hidden ? (
                    <>
                      <span className="text-xs text-subtle">Removed from the form</span>
                      <button type="button" className="btn btn-ghost btn-sm" aria-label={`Restore ${l.label}`} onClick={() => patch(l.id, { hidden: false })}><RotateCcw size={14} /> Restore</button>
                    </>
                  ) : <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove ${l.label}`} onClick={() => patch(l.id, { hidden: true })}><Trash2 size={14} /> Remove</button>
              ) : (
                <>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!l.hidden} onChange={(e) => patch(l.id, { hidden: !e.target.checked })} /> Shown</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={l.required} onChange={(e) => patch(l.id, { required: e.target.checked })} /> Required</label>
                  <button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove ${l.label}`} onClick={() => set(mine.filter((x) => x.id !== l.id))}><Trash2 size={14} /> Remove</button>
                </>
              )}
            </div>
            {!l.builtin && l.kind === "select" && (
              <label className="mt-3 block text-sm">Choices, one per line
                <textarea className="input mt-1" rows={3} value={l.optionsText} onChange={(e) => patch(l.id, { optionsText: e.target.value })} />
              </label>
            )}
          </li>
        ))}
      </ol>

      <section aria-label="Add a field" className="glass !rounded-md space-y-3 p-4">
        <h3 className="text-lg">Add a field</h3>
        {extraCount >= MAX_FIELDS_PER_FORM ? <p className="text-sm text-muted">This form already has the most extra fields it can have.</p> : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block min-w-56 flex-1 text-sm">Name
                <input className="input mt-1" value={add.label} maxLength={MAX_LABEL} onChange={(e) => setAdd({ ...add, label: e.target.value })} />
              </label>
              <label className="block text-sm">Kind
                <select className="input mt-1" value={add.kind} onChange={(e) => setAdd({ ...add, kind: e.target.value as CustomKind })}>
                  {CUSTOM_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={add.required} onChange={(e) => setAdd({ ...add, required: e.target.checked })} /> Required</label>
              <button type="button" className="btn btn-primary btn-sm mb-1" onClick={addField}><Plus size={14} /> Add field</button>
            </div>
            {add.kind === "select" && (
              <label className="block text-sm">Choices, one per line
                <textarea className="input mt-1" rows={3} value={add.optionsText} onChange={(e) => setAdd({ ...add, optionsText: e.target.value })} />
              </label>
            )}
          </>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={save}>{saving ? "Saving…" : "Save this form"}</button>
        <button type="button" className="btn btn-ghost" disabled={!dirty || saving} onClick={() => set(saved[form])}>Discard changes</button>
        {dirty && <span className="text-sm text-muted">There are changes that are not saved yet.</span>}
      </div>
    </div>
  );
}
