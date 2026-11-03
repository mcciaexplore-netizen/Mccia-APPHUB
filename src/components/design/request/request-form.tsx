"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, Copy, Plus, Trash2 } from "lucide-react";
import type { DesignQuestion } from "@/db/design-schema";
import { submitRequest } from "@/lib/design/actions/requests";
import { MAX_FILES, MAX_FILE_MB, MAX_REFERENCE_LINKS } from "@/lib/design/form";
import { priorityFor } from "@/lib/design/rules";
import { FileDrop } from "../file-drop";
import { PriorityBadge } from "../ui";

/**
 * The request form, in four cards: what is needed (each ticked design opens its own questions), the brief and event, when it is needed
 * (the priority follows from the date), and reference files. Files upload as they are added; the button waits for them.
 */

type FormType = { key: string; name: string; questions: DesignQuestion[] };

/** An emoji for each kind of design on its tile; a kind a lead added later gets the palette. */
const TYPE_EMOJI: Record<string, string> = {
  flyer: "📄",
  whatsapp: "💬",
  instagram: "📸",
  linkedin: "💼",
  twitter: "🐦",
  banner: "🪧",
  backdrop: "🖥️",
  book: "📚",
  brochure2: "📋",
  brochure4: "📑",
  other: "✏️",
};

/** One of the form's sections: a white card with a navy title (the form's own look, a little roomier than the module's cards). */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#e5e7eb] bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.08)] sm:p-7">
      <h2 className="mb-5 text-[1.05rem] font-bold text-[#003F8A]">{title}</h2>
      {children}
    </section>
  );
}
type Answers = Record<string, Record<string, string>>;

const required = <span className="text-[var(--ds-red)]" aria-hidden> *</span>;

function Question({ q, id, value, onChange }: { q: DesignQuestion; id: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm" htmlFor={id}>
      <span className="font-medium text-ink">
        {q.label}
        {q.required && required}
      </span>
      {q.type === "select" ? (
        <select id={id} className="input" value={value} required={q.required} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {q.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input id={id} className="input" type={q.type === "number" ? "number" : "text"} min={q.type === "number" ? 1 : undefined} value={value} required={q.required} maxLength={200} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}

export function RequestForm({ types, departments, defaultDepartment, minDelivery, today }: { types: FormType[]; departments: string[]; defaultDepartment: string; minDelivery: string; today: string }) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Answers>({});
  const [brief, setBrief] = useState("");
  const [content, setContent] = useState("");
  const [eventName, setEventName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [links, setLinks] = useState<string[]>([""]);
  const [department, setDepartment] = useState(defaultDepartment);
  const [delivery, setDelivery] = useState("");
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ number: string; trackingUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const [pending, start] = useTransition();

  const byKey = useMemo(() => new Map(types.map((t) => [t.key, t])), [types]);
  const toggle = (key: string) => setChosen((c) => (c.includes(key) ? c.filter((k) => k !== key) : [...c, key]));
  const answer = (type: string, q: string, v: string) => setAnswers((a) => ({ ...a, [type]: { ...(a[type] ?? {}), [q]: v } }));

  const reset = () => {
    setChosen([]);
    setAnswers({});
    setBrief("");
    setContent("");
    setEventName("");
    setEventDate("");
    setLinks([""]);
    setDepartment(defaultDepartment);
    setDelivery("");
    setFileIds([]);
    setError(null);
    setDone(null);
    setCopied(false);
    setFormKey((k) => k + 1);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!chosen.length) return setError("Choose at least one kind of design.");
    start(async () => {
      const res = await submitRequest({
        requirements: chosen,
        details: Object.fromEntries(chosen.map((k) => [k, answers[k] ?? {}])),
        brief,
        content,
        eventName,
        eventDate,
        department,
        deliveryDate: delivery,
        referenceLinks: links,
        fileIds,
      });
      if (res.ok) {
        setDone({ number: res.data.number, trackingUrl: res.data.trackingUrl });
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else setError(res.error);
    });
  };

  if (done)
    return (
      <div className="ds-card flex flex-col items-center gap-4 px-6 py-10 text-center">
        <CheckCircle2 size={48} className="text-[var(--ds-green)]" aria-hidden />
        <div>
          <p className="text-sm ds-muted">Ticket</p>
          <p className="text-3xl font-extrabold text-[var(--ds-navy)]">{done.number}</p>
        </div>
        <h2 className="text-xl font-bold text-ink">Your request has been submitted</h2>
        <p className="max-w-md text-sm ds-muted">A design lead will review it shortly. We have emailed you a confirmation. Follow its progress with this link:</p>
        <div className="flex w-full max-w-lg items-center gap-2 rounded-lg border border-[var(--ds-navy-line)] bg-[var(--ds-navy-tint)] px-3 py-2">
          <a href={done.trackingUrl} className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-[var(--ds-navy)] hover:underline" target="_blank" rel="noreferrer">
            {done.trackingUrl}
          </a>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(done.trackingUrl);
              setCopied(true);
            }}
          >
            <Copy size={14} aria-hidden /> {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/design/my-requests" className="btn btn-sm ds-btn-navy">
            See my requests
          </Link>
          <button type="button" className="btn btn-sm btn-ghost" onClick={reset}>
            Submit another request
          </button>
        </div>
      </div>
    );

  const priority = delivery && delivery >= minDelivery ? priorityFor(delivery, today) : null;

  return (
    <form key={formKey} onSubmit={submit} className="flex flex-col gap-6" noValidate={false}>
      <Section title="What do you need?">
        <fieldset>
          <legend className="sr-only">Kinds of design</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {types.map((t) => {
              const on = chosen.includes(t.key);
              return (
                <label
                  key={t.key}
                  className={`relative flex cursor-pointer items-center gap-3 rounded-xl border p-4 text-sm font-semibold transition duration-150 ${
                    on
                      ? "scale-[1.02] border-[#003F8A] bg-[#E8F0FE] text-[#003F8A] shadow-[0_4px_12px_rgba(0,63,138,0.15)]"
                      : "border-[#e5e7eb] bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.05)] hover:border-[#9ca3af] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]"
                  }`}
                >
                  <span className="text-2xl leading-none" aria-hidden>
                    {TYPE_EMOJI[t.key] ?? "🎨"}
                  </span>
                  <span className="min-w-0 flex-1">{t.name}</span>
                  <input type="checkbox" className="ds-check" aria-label={t.name} checked={on} onChange={() => toggle(t.key)} />
                </label>
              );
            })}
          </div>
        </fieldset>
        {chosen.length > 0 && (
          <div className="mt-5 flex flex-col gap-4">
            {chosen.map((k) => {
              const t = byKey.get(k);
              if (!t) return null;
              return (
                <div key={k} className="rounded-lg border border-[var(--ds-line)] bg-[#fafafa] p-4">
                  <p className="ds-label mb-3">{t.name}</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {t.questions.map((q) => (
                      <Question key={q.id} q={q} id={`q-${k}-${q.id}`} value={answers[k]?.[q.id] ?? ""} onChange={(v) => answer(k, q.id, v)} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section title="Request details">
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm" htmlFor="brief">
            <span className="font-medium text-ink">Title / brief{required}</span>
            <textarea id="brief" className="input min-h-32" required minLength={5} maxLength={5000} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="What is the design for, what should it say, any colours, logos or wording to use…" />
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm" htmlFor="event-name">
              <span className="font-medium text-ink">Event name (if applicable)</span>
              <input id="event-name" className="input" maxLength={200} value={eventName} onChange={(e) => setEventName(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm" htmlFor="event-date">
              <span className="font-medium text-ink">Event date</span>
              <input id="event-date" type="date" className="input" min={today} value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm" htmlFor="department">
            <span className="font-medium text-ink">Department</span>
            <input id="department" className="input" list="ds-departments" maxLength={120} value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Choose or type your department" />
            <datalist id="ds-departments">
              {departments.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </label>
        </div>
      </Section>

      <Section title="References">
        <p className="-mt-1 mb-4 text-sm ds-muted">Add links or files for reference (logos, examples, inspiration, content)</p>
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2 text-sm">
              <span className="font-semibold text-ink">Links <span className="font-normal ds-muted">(optional)</span></span>
              <span className="-mt-1 text-xs ds-muted">Up to {MAX_REFERENCE_LINKS} web links (https://...).</span>
              {links.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className="input flex-1"
                    type="url"
                    inputMode="url"
                    placeholder="https://..."
                    aria-label={`Reference link ${i + 1}`}
                    value={l}
                    onChange={(e) => setLinks((ls) => ls.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    aria-label={`Remove link ${i + 1}`}
                    disabled={links.length === 1 && !l}
                    onClick={() => setLinks((ls) => (ls.length === 1 ? [""] : ls.filter((_, j) => j !== i)))}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {links.length < MAX_REFERENCE_LINKS && (
                <button type="button" className="btn btn-sm btn-ghost self-start" onClick={() => setLinks((ls) => [...ls, ""])}>
                  <Plus size={14} aria-hidden /> Add another link
                </button>
              )}
            </div>
          <div className="flex flex-col gap-2 text-sm">
            <span className="font-semibold text-ink">Files <span className="font-normal ds-muted">(optional)</span></span>
            <FileDrop
              purpose="attachment"
              maxFiles={MAX_FILES}
              maxMb={MAX_FILE_MB}
              onChange={setFileIds}
              onBusy={setUploading}
              label="Drop files here or click to browse"
              hint={`Share content for Design Creatives · Word, PDF, PowerPoint, Excel, images, text, RTF, ODT, Markdown · up to ${MAX_FILES} files, ${MAX_FILE_MB} MB each`}
            />
          </div>
          <label className="flex flex-col gap-2 text-sm" htmlFor="content">
            <span className="font-semibold text-ink">Share content for Design Creatives</span>
            <span className="-mt-1 text-xs ds-muted">(Or if you have any other design requirement please mention in the document)</span>
            <textarea
              id="content"
              className="input min-h-32"
              rows={5}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Type your content here... (text for banner, social media post, event details, etc.)"
            />
          </label>
        </div>
      </Section>

      <Section title="When do you need it?">
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm" htmlFor="delivery">
            <span className="font-medium text-ink">Delivery date{required}</span>
            <input id="delivery" type="date" className="input" required min={minDelivery} value={delivery} onChange={(e) => setDelivery(e.target.value)} />
          </label>
          <div className="flex items-center gap-2 pb-2 text-sm" aria-live="polite">
            <span className="ds-muted">Priority:</span>
            {priority ? <PriorityBadge priority={priority} /> : <span className="ds-muted">choose a date</span>}
          </div>
        </div>
        <p className="mt-2 text-xs ds-muted">Next day or sooner is Urgent, within 3 days High, within 10 days Normal, later Low.</p>
      </Section>


      {error && (
        <p role="alert" className="alert alert-red text-sm">
          {error}
        </p>
      )}
      <button type="submit" className="btn ds-btn-navy h-14 w-full justify-center rounded-xl text-base font-bold" disabled={pending || uploading}>
        {uploading ? "Waiting for files to upload…" : pending ? "Submitting…" : "Submit request →"}
      </button>
    </form>
  );
}
