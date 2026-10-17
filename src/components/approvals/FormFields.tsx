"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronDown, Mail, Plus, Search, Upload, X } from "lucide-react";
import { Modal } from "@/components/Modal";
import { api } from "@/components/approvals/api";
import {
  formatDateTime, formatINR, fromDateTimeLocal, isoToDisplay, parseDisplayDate, parseDisplayDateTime, parseINR, toDateTimeLocal,
} from "@/lib/approvals/format";
import { ACCEPT_ATTRIBUTE, ALLOWED_EXTENSIONS, MAX_FILE_BYTES, isAllowedFileName } from "@/lib/approvals/request-schemas";
import type { MasterKind } from "@/lib/approvals/validation";

/** The form building blocks, laid out like the Zoho forms: the label in one column, the input in the next. */

export function Row({
  label, required, hint, error, wide, htmlFor, children,
}: { label: string; required?: boolean; hint?: string; error?: string | null; wide?: boolean; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="zf-row">
      <label className="zf-label" htmlFor={htmlFor}>{label}{required && <span className="zf-req" aria-hidden> *</span>}</label>
      <div className={`zf-field ${wide ? "zf-field-wide" : ""}`}>
        {children}
        {hint && !error && <p className="zf-hint">{hint}</p>}
        {error && <p className="zf-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}

/** The browser's own calendar, opened from our button. Some browsers refuse (no user gesture, or no support): then typing still works. */
const openPicker = (el: HTMLInputElement | null) => { try { el?.showPicker?.(); } catch { el?.focus(); } };

const inputClass = (invalid?: boolean, extra = "") => `input ${invalid ? "zf-invalid" : ""} ${extra}`.trim();

export function TextInput({ value, onChange, id, invalid, maxLength, placeholder }: { value: string; onChange: (v: string) => void; id?: string; invalid?: boolean; maxLength?: number; placeholder?: string }) {
  return <input id={id} className={inputClass(invalid)} value={value} onChange={(e) => onChange(e.target.value)} maxLength={maxLength ?? 200} placeholder={placeholder} />;
}

export function TextArea({ value, onChange, id, rows = 4 }: { value: string; onChange: (v: string) => void; id?: string; rows?: number }) {
  return <textarea id={id} className={inputClass(false, "!h-[100px] w-full resize-y")} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} maxLength={4000} />;
}

export function EmailInput({ value, onChange, id, invalid }: { value: string; onChange: (v: string) => void; id?: string; invalid?: boolean }) {
  return (
    <div className="zf-control">
      <input id={id} type="email" inputMode="email" autoComplete="off" className={inputClass(invalid)} value={value} onChange={(e) => onChange(e.target.value)} maxLength={200} />
      <span className="zf-addon" aria-hidden><Mail size={15} /></span>
    </div>
  );
}

/** Rupees, typed freely and tidied into Indian grouping when the box is left. The parent keeps the text; parseINR turns it into paise. */
export function MoneyInput({ value, onChange, id, invalid }: { value: string; onChange: (v: string) => void; id?: string; invalid?: boolean }) {
  return (
    <div className="zf-control">
      <input
        id={id} inputMode="decimal" autoComplete="off" placeholder="##,##,###.##" className={inputClass(invalid)} value={value} maxLength={20}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,\s₹]/g, ""))}
        onBlur={() => { const p = parseINR(value); if (p !== null && value.trim() !== "") onChange(formatINR(p)); }}
      />
      <span className="zf-addon" aria-hidden>₹</span>
    </div>
  );
}

/** A figure the form works out itself: grey, not editable, with the rupee sign. Negative values are red. */
export function ReadOnlyMoney({ paise, empty = "", id, placeholder = "##,##,###.##" }: { paise: number | null; empty?: string; id?: string; placeholder?: string }) {
  return (
    <div className="zf-control">
      <input id={id} readOnly tabIndex={-1} className={inputClass(false, `zf-ro ${paise != null && paise < 0 ? "zf-neg" : ""}`)} value={paise == null ? empty : formatINR(paise)} placeholder={placeholder} aria-readonly="true" />
      <span className="zf-addon" aria-hidden>₹</span>
    </div>
  );
}

/** A date shown as dd-MMM-yyyy, typed or picked from the calendar button. The value is "YYYY-MM-DD", or empty. */
export function DateInput({ value, onChange, id, invalid, max }: { value: string; onChange: (iso: string) => void; id?: string; invalid?: boolean; max?: string }) {
  const [text, setText] = useState(isoToDisplay(value));
  const [seen, setSeen] = useState(value);
  const picker = useRef<HTMLInputElement>(null);
  // A change that came from outside (Reset, a pre-filled link) replaces what is shown.
  if (seen !== value) { setSeen(value); setText(isoToDisplay(value)); }

  const commit = (t: string) => {
    if (t.trim() === "") { onChange(""); return; }
    const iso = parseDisplayDate(t);
    if (iso) { setText(isoToDisplay(iso)); setSeen(iso); onChange(iso); } else { setText(isoToDisplay(value)); }
  };
  return (
    <div className="zf-control" style={{ position: "relative" }}>
      <input id={id} className={inputClass(invalid)} placeholder="dd-MMM-yyyy" value={text} onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commit(text))} maxLength={11} autoComplete="off" />
      <button type="button" className="zf-addon" aria-label="Open calendar" onClick={() => openPicker(picker.current)}><CalendarDays size={15} /></button>
      <input ref={picker} type="date" tabIndex={-1} aria-hidden className="pointer-events-none absolute h-0 w-0 opacity-0" max={max} value={value} onChange={(e) => { setText(isoToDisplay(e.target.value)); setSeen(e.target.value); onChange(e.target.value); }} />
    </div>
  );
}

/** A date and time shown as "05-Oct-2026 10:33:55" in Indian time. The value is an instant (ISO text), empty when not understood. */
export function DateTimeInput({ value, onChange, id, invalid }: { value: string; onChange: (iso: string) => void; id?: string; invalid?: boolean }) {
  const show = (iso: string) => (iso ? formatDateTime(new Date(iso)) : "");
  const [text, setText] = useState(show(value));
  const [seen, setSeen] = useState(value);
  const picker = useRef<HTMLInputElement>(null);
  if (seen !== value) { setSeen(value); setText(show(value)); }

  const commit = (t: string) => {
    const d = parseDisplayDateTime(t);
    if (d) { const iso = d.toISOString(); setText(show(iso)); setSeen(iso); onChange(iso); } else { setText(show(value)); }
  };
  return (
    <div className="zf-control" style={{ position: "relative" }}>
      <input id={id} className={inputClass(invalid)} placeholder="dd-MMM-yyyy HH:mm:ss" value={text} onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commit(text))} maxLength={20} autoComplete="off" />
      <button type="button" className="zf-addon" aria-label="Open calendar" onClick={() => openPicker(picker.current)}><CalendarDays size={15} /></button>
      <input
        ref={picker} type="datetime-local" tabIndex={-1} aria-hidden className="pointer-events-none absolute bottom-0 right-0 h-0 w-0 opacity-0"
        value={value ? toDateTimeLocal(new Date(value)) : ""}
        onChange={(e) => { const d = fromDateTimeLocal(e.target.value); if (d) { const iso = d.toISOString(); setText(show(iso)); setSeen(iso); onChange(iso); } }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- searchable dropdown */

export type Option = { value: string; label: string };
export type AddNew = {
  /** Which list the new value is added to. */
  kind: MasterKind;
  /** Singular, for the dialog: "category", "branch". */
  noun: string;
  /** Extra fields the server needs, for example the publication type a publication belongs to. */
  extra?: Record<string, string>;
  onAdded: (option: Option) => void;
};

/** "-Select-" with a caret; opens a box with a search field, the list, and (for admins) a "+ Add New" footer. */
export function SearchSelect({
  options, value, onChange, id, invalid, add, placeholder = "-Select-", disabled,
}: { options: Option[]; value: string; onChange: (v: string) => void; id?: string; invalid?: boolean; add?: AddNew; placeholder?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hot, setHot] = useState(0);
  const [adding, setAdding] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = `${useId()}-list`;

  const needle = q.trim().toLowerCase();
  const shown = options.filter((o) => !needle || o.label.toLowerCase().includes(needle));
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  useEffect(() => { if (open) search.current?.focus(); }, [open]);

  const openBox = () => { if (disabled) return; setQ(""); setHot(Math.max(0, options.findIndex((o) => o.value === value))); setOpen(true); };
  const pick = (o: Option) => { onChange(o.value); setOpen(false); trigger.current?.focus(); };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHot((h) => Math.min(h + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHot((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (shown[hot]) pick(shown[hot]); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); trigger.current?.focus(); }
  };

  return (
    <div className="zd" ref={box}>
      <button
        type="button" id={id} ref={trigger} disabled={disabled} onClick={() => (open ? setOpen(false) : openBox())} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? list : undefined}
        className={inputClass(invalid, "zd-btn cursor-pointer text-left disabled:cursor-not-allowed disabled:opacity-60")}
      >
        <span className={`truncate ${current ? "" : "zd-ph"}`}>{current?.label ?? placeholder}</span>
        <ChevronDown size={14} className="shrink-0 text-[#444]" aria-hidden />
      </button>
      {open && (
        <div className="zd-pop" onKeyDown={key}>
          <div className="zd-search">
            <Search size={14} aria-hidden />
            <input ref={search} value={q} onChange={(e) => { setQ(e.target.value); setHot(0); }} placeholder="Search" aria-label="Search" aria-controls={list} />
          </div>
          <div className="zd-list" id={list} role="listbox">
            {shown.length === 0 && <p className="zd-empty">Nothing matches.</p>}
            {shown.map((o, i) => (
              <button key={o.value} type="button" role="option" aria-selected={o.value === value} data-hot={i === hot} className="zd-opt" onMouseEnter={() => setHot(i)} onClick={() => pick(o)}>
                {o.label}
              </button>
            ))}
          </div>
          {add && (
            <div className="zd-foot">
              <button type="button" className="zd-add" onClick={() => { setOpen(false); setAdding(true); }}><Plus size={14} /> Add New</button>
            </div>
          )}
        </div>
      )}
      {/* The dialog has a form of its own. Rendered in place it would sit inside the request form, and a form inside a form submits the
          whole page. So it is moved out in the page (still inside .apr-root, so it keeps the module's look). */}
      {adding && add && createPortal(
        <AddNewDialog add={add} initial={q} onClose={() => setAdding(false)} onDone={(o) => { add.onAdded(o); onChange(o.value); setAdding(false); }} />,
        document.querySelector(".apr-root") ?? document.body,
      )}
    </div>
  );
}

function AddNewDialog({ add, initial, onClose, onDone }: { add: AddNew; initial: string; onClose: () => void; onDone: (o: Option) => void }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    setError(null);
    const r = await api<{ item: { id: string; name: string } }>("POST", `/api/approvals/masters/${add.kind}`, { name, ...add.extra });
    setBusy(false);
    if (r.ok) onDone({ value: r.data.item.id, label: r.data.item.name }); else setError(r.error);
  };
  return (
    <Modal title={`Add new ${add.noun}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label-xs mb-1.5 block" htmlFor="zd-new-name">Name</label>
          <input id="zd-new-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus required />
          {error && <p className="zf-error">{error}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" disabled={busy || !name.trim()}>{busy ? "Adding…" : "Add"}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------------- files */

export type UploadedFile = { fileId: string; name: string };

/** One attachment. Chooses a file, checks it, and sends it to the server in parts; reports the id once it is safely stored. */
export function FileInput({
  value, onChange, onBusy, id, label,
}: { value: UploadedFile | null; onChange: (f: UploadedFile | null) => void; onBusy?: (busy: boolean) => void; id?: string; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const putPart = async (fileId: string, index: number, part: Blob) => {
    let last = "Could not send the file. Check your connection and try again.";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`/api/approvals/uploads/${fileId}?i=${index}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: part });
        if (res.ok) return null;
        const ct = res.headers.get("content-type") ?? "";
        last = ct.includes("json") ? ((await res.json()).error ?? last) : "Your session has ended. Please sign in again.";
        if (res.status < 500 && res.status !== 429) break; // a refusal will not change on retry
      } catch { /* network drop: try again */ }
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
    return last;
  };

  const choose = async (file: File) => {
    setError(null);
    if (!isAllowedFileName(file.name)) return setError(`Only ${ALLOWED_EXTENSIONS.map((e) => e.toUpperCase()).join(", ")} files are allowed.`);
    if (file.size === 0) return setError("That file is empty.");
    if (file.size > MAX_FILE_BYTES) return setError("Files can be at most 10 MB.");
    onBusy?.(true);
    setProgress(0);
    const start = await api<{ fileId: string; chunkCount: number; chunkBytes: number }>("POST", "/api/approvals/uploads", { fileName: file.name, size: file.size });
    if (!start.ok) { setError(start.error); setProgress(null); onBusy?.(false); return; }
    const { fileId, chunkCount, chunkBytes } = start.data;
    for (let i = 0; i < chunkCount; i++) {
      const failed = await putPart(fileId, i, file.slice(i * chunkBytes, Math.min(file.size, (i + 1) * chunkBytes)));
      if (failed) { setError(failed); setProgress(null); onBusy?.(false); return; }
      setProgress(Math.round(((i + 1) / chunkCount) * 100));
    }
    setProgress(null);
    onBusy?.(false);
    onChange({ fileId, name: file.name });
  };

  return (
    <div>
      <div className="zf-control">
        <button type="button" id={id} aria-label={`${label}: select a file`} className={inputClass(false, "cursor-pointer text-left !text-[#8a9099]")} onClick={() => input.current?.click()} disabled={progress !== null}>
          {progress !== null ? "Uploading…" : "Select File"}
        </button>
        <button type="button" className="zf-addon" aria-label="Choose a file" onClick={() => input.current?.click()} disabled={progress !== null}><Upload size={15} /></button>
        <input
          ref={input} type="file" accept={ACCEPT_ATTRIBUTE} className="hidden" tabIndex={-1}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void choose(f); }}
        />
      </div>
      {progress !== null && <div className="zfile-bar" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div>}
      {value && progress === null && (
        <p className="zfile-name">
          <span className="truncate" title={value.name}>{value.name}</span>
          <button type="button" aria-label={`Remove ${value.name}`} title="Remove" onClick={() => onChange(null)} className="rounded p-0.5 text-[#777] hover:bg-[#eee] hover:text-[#222]"><X size={14} /></button>
        </p>
      )}
      {error && <p className="zf-error" role="alert">{error}</p>}
    </div>
  );
}

export function FormActions({ submitting, disabled, onReset, label = "Submit", resetLabel = "Reset" }: { submitting: boolean; disabled?: boolean; onReset: () => void; label?: string; resetLabel?: string }) {
  return (
    <div className="zf-actions">
      <button type="submit" className="btn btn-primary" disabled={submitting || disabled}>{submitting ? "Submitting…" : label}</button>
      <button type="button" className="btn btn-ghost" onClick={onReset} disabled={submitting}>{resetLabel}</button>
    </div>
  );
}
