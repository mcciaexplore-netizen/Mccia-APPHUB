"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { BarChart3, Bot, Code2, Globe, Plus, Sparkles, Trash2, Zap, type LucideIcon } from "lucide-react";
import { submitRequest } from "@/lib/aistudio/actions/requests";
import { MAX_FILES, MAX_FILE_MB, MAX_LINKS, REQUEST_TYPES, TYPE_HINT, TYPE_LABEL } from "@/lib/aistudio/aistudio.manifest";
import type { RequestType } from "@/db/aistudio-schema";
import { FileDrop } from "../file-drop";

/** One of the form's sections: a white card with a navy title. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#e5e7eb] bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.08)] sm:p-7">
      <h2 className="mb-5 text-[1.05rem] font-bold text-[#003F8A]">{title}</h2>
      {children}
    </section>
  );
}

/** Each kind of request's icon on its tile. */
const TYPE_ICON: Record<RequestType, LucideIcon> = {
  app_development: Code2,
  automation: Zap,
  chatbot: Bot,
  data_analysis: BarChart3,
  website_tool: Globe,
  other: Sparkles,
};

const required = <span className="text-[var(--ai-red)]"> *</span>;

/**
 * The request form, in three cards: what is needed (one kind), the project's name, description and department, and references (links, a
 * text box and files, all optional). Files upload as they are added; the button waits for them. After sending: the request's number.
 */
export function RequestForm({ departments, defaultDepartment }: { departments: string[]; defaultDepartment: string }) {
  const [type, setType] = useState<RequestType | "">("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [department, setDepartment] = useState(defaultDepartment);
  const [links, setLinks] = useState<string[]>([""]);
  const [content, setContent] = useState("");
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; number: string } | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!type) return setError("Choose what you need");
    start(async () => {
      const r = await submitRequest({ requestType: type, title, description, department, referenceLinks: links, content, fileIds });
      if (r.ok) {
        setDone(r.data);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else setError(r.error);
    });
  };

  if (done)
    return (
      <div className="ai-card flex flex-col items-center gap-4 px-6 py-10 text-center">
        <Sparkles size={48} className="text-[#003F8A]" aria-hidden />
        <div>
          <p className="text-sm ai-muted">Request</p>
          <p className="text-3xl font-extrabold text-[var(--ai-navy)]">{done.number}</p>
        </div>
        <h2 className="text-xl font-bold text-ink">Your request has been submitted</h2>
        <p className="max-w-md text-sm ai-muted">AI Studio will review and get back to you soon.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link href={`/aistudio/requests/${done.id}`} className="btn btn-sm ai-btn-navy">
            Track your request →
          </Link>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              setDone(null);
              setType("");
              setTitle("");
              setDescription("");
              setLinks([""]);
              setContent("");
              setFileIds([]);
              setFormKey((k) => k + 1);
            }}
          >
            Submit another request
          </button>
        </div>
      </div>
    );

  return (
    <form key={formKey} onSubmit={submit} className="flex flex-col gap-6">
      <Section title="What do you need?">
        <fieldset>
          <legend className="sr-only">Kind of request</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {REQUEST_TYPES.map((t) => {
              const on = type === t;
              const Icon = TYPE_ICON[t];
              return (
                <label
                  key={t}
                  className={`relative flex cursor-pointer items-start gap-3 rounded-xl border p-4 text-sm transition duration-150 ${
                    on ? "border-[#003F8A] bg-[#003F8A] shadow-[0_4px_12px_rgba(0,63,138,0.25)]" : "border-[#e5e7eb] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] hover:border-[#9ca3af] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]"
                  }`}
                >
                  <Icon size={22} className={`mt-0.5 shrink-0 ${on ? "text-white" : "text-[#003F8A]"}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={`block font-semibold ${on ? "text-white" : "text-ink"}`}>{TYPE_LABEL[t]}</span>
                    <span className={`mt-0.5 block text-xs ${on ? "text-white/80" : "ai-muted"}`}>{TYPE_HINT[t]}</span>
                  </span>
                  <input type="radio" name="requestType" value={t} className={`ai-check mt-0.5 ${on ? "ai-check-light" : ""}`} aria-label={TYPE_LABEL[t]} checked={on} onChange={() => setType(t)} />
                </label>
              );
            })}
          </div>
        </fieldset>
      </Section>

      <Section title="Request details">
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm" htmlFor="title">
            <span className="font-medium text-ink">Project name{required}</span>
            <input id="title" className="input" required minLength={3} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm" htmlFor="description">
            <span className="font-medium text-ink">Description{required}</span>
            <textarea
              id="description"
              className="input min-h-36"
              required
              minLength={10}
              maxLength={10000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what you need, why you need it, and what problem it solves..."
            />
          </label>
          <label className="flex flex-col gap-1 text-sm" htmlFor="department">
            <span className="font-medium text-ink">Department</span>
            <input id="department" className="input" list="ai-departments" maxLength={120} value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Choose or type your department" />
            <datalist id="ai-departments">
              {departments.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </label>
        </div>
      </Section>

      <Section title="References (optional)">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2 text-sm">
            <span className="font-semibold text-ink">Links</span>
            <span className="-mt-1 text-xs ai-muted">Up to {MAX_LINKS} web links (https://...).</span>
            {links.map((l, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className="input flex-1"
                  type="url"
                  inputMode="url"
                  placeholder="https://..."
                  aria-label={`Link ${i + 1}`}
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
            {links.length < MAX_LINKS && (
              <button type="button" className="btn btn-sm btn-ghost self-start" onClick={() => setLinks((ls) => [...ls, ""])}>
                <Plus size={14} aria-hidden /> Add another link
              </button>
            )}
          </div>
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex flex-col gap-1">
              <label htmlFor="content" className="font-semibold text-ink">
                Share any relevant files or content
              </label>
              <span className="text-xs ai-muted">(Documents, spreadsheets, screenshots, examples, etc.)</span>
            </div>
            <textarea id="content" className="input min-h-28" rows={4} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Any additional details or content to share..." />
            <FileDrop purpose="attachment" maxFiles={MAX_FILES} maxMb={MAX_FILE_MB} onChange={setFileIds} onBusy={setUploading} hint={`Drag and drop or click to browse · any file type · up to ${MAX_FILES} files, ${MAX_FILE_MB} MB each`} />
          </div>
        </div>
      </Section>

      {error && (
        <p role="alert" className="alert alert-red text-sm">
          {error}
        </p>
      )}
      <button type="submit" className="btn ai-btn-navy h-14 w-full justify-center rounded-xl text-base font-bold" disabled={pending || uploading}>
        {uploading ? (
          "Waiting for files to upload…"
        ) : pending ? (
          "Submitting…"
        ) : (
          <>
            <Sparkles size={18} aria-hidden /> Submit request →
          </>
        )}
      </button>
    </form>
  );
}
