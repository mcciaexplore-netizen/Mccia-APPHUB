"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDownLeft, ArrowUpRight, X } from "lucide-react";
import { cx as clsx } from "@/lib/ivr/cx";
import { closeLead, reopenLead, saveNote, updateLeadDetails, wrapUpCall } from "@/lib/ivr/actions/leads";
import { CallButton } from "@/components/ivr/call-button";
import { EmailTab } from "@/components/ivr/lead/email-tab";
import { RecordingPlayer } from "@/components/ivr/recording-player";
import { Alert, CallStatusPill, StagePill } from "@/components/ivr/ui";
import type { StageKey } from "@/lib/ivr/stage";

export type PanelData = {
  lead: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    company: string | null;
    memberCode: string | null;
    categoryId: string | null;
    source: string | null;
    stage: StageKey;
    attempts: number;
    lastOutcome: string | null;
    ownerName: string | null;
    createdAt: string;
    extra: Record<string, string>;
  };
  categories: { id: string; label: string }[];
  calls: {
    id: string;
    direction: string;
    status: string;
    outcome: string | null;
    when: string;
    duration: string;
    hasRecording: boolean;
    dtmf: string | null;
    categoryId: string | null;
    categorySource: string | null;
    remark: string | null;
    agentName: string | null;
    disposition: string | null;
  }[];
  notes: { id: string; body: string; when: string; by: string | null }[];
  emails: {
    id: string;
    subject: string;
    body: string;
    toAddress: string;
    status: string;
    error: string | null;
    sentAt: Date;
    userName: string | null;
  }[];
  history: { when: string; text: string }[];
  zohoConnected: boolean;
  /** A missed inbound call from this member is still waiting for a call back. */
  openMissed: boolean;
};

const TABS = ["calls", "details", "notes", "email"] as const;
type Tab = (typeof TABS)[number];

type Run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, okText?: string) => void;

function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return (
    <Alert kind={m.ok ? "success" : "error"} role={m.ok ? "status" : "alert"} className="mt-2 px-3 py-2 text-[0.8rem]">
      {m.text}
    </Alert>
  );
}

export function LeadPanelClient({ data, closeHref }: { data: PanelData; closeHref: string }) {
  const { lead } = data;
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("calls");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const run: Run = (fn, okText) =>
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.ok ? (r.message ?? okText ?? "Saved") : (r.error ?? "Something went wrong") });
      if (r.ok) router.refresh();
    });

  return (
    <div className="ivr-card flex max-h-[calc(100vh-3.5rem)] flex-col overflow-hidden lg:sticky lg:top-4">
      <div className="flex items-start justify-between gap-3 border-b border-line p-5">
        <div className="min-w-0">
          <h2 className="truncate text-2xl leading-tight">{lead.name}</h2>
          <p className="mt-0.5 font-mono text-[12px] text-muted">
            {lead.phone}
            {lead.email ? ` · ${lead.email}` : ""}
          </p>
          {(lead.company || lead.memberCode) && (
            <p className="mt-0.5 text-[12px] text-muted">
              {[lead.company, lead.memberCode ? `Member ${lead.memberCode}` : null].filter(Boolean).join(" · ")}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StagePill stage={lead.stage} />
            <span className="text-[12px] text-muted">
              {lead.attempts} {lead.attempts === 1 ? "try" : "tries"}
              {lead.lastOutcome ? ` · last: ${lead.lastOutcome}` : ""}
            </span>
            <span className="text-[12px] text-muted">Owner: {lead.ownerName ?? "Unassigned"}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-start gap-2">
          <CallButton leadId={lead.id} callBack={data.openMissed} disabled={lead.stage === "closed"} onResult={(m) => setMsg(m)} />
          <Link href={closeHref} scroll={false} className="btn btn-ghost btn-sm px-2.5" aria-label="Close panel">
            <X className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="border-b border-line px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-muted">
            The stage follows the calls. Close a member when there is nothing more to do.
          </span>
          {lead.stage === "closed" ? (
            <button className="btn btn-ghost btn-sm ml-auto" disabled={pending} onClick={() => run(() => reopenLead(lead.id), "Reopened")}>
              Reopen
            </button>
          ) : (
            <button className="btn btn-ghost btn-sm ml-auto" disabled={pending} onClick={() => run(() => closeLead(lead.id), "Closed")}>
              Close member
            </button>
          )}
        </div>
        <Msg m={msg} />
      </div>

      <div role="tablist" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-4">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={clsx(
              "-mb-px border-b-2 px-3 py-3 text-[0.85rem] whitespace-nowrap transition-colors duration-200 first-letter:uppercase",
              tab === t ? "border-primary font-semibold text-primary" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t === "calls" ? `calls and recordings (${data.calls.length})` : t === "notes" ? `notes (${data.notes.length})` : t}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {tab === "calls" && <CallsTab data={data} run={run} pending={pending} />}
        {tab === "details" && <DetailsTab data={data} run={run} pending={pending} />}
        {tab === "notes" && <NotesTab data={data} run={run} pending={pending} />}
        {tab === "email" && (
          <EmailTab lead={{ id: lead.id, name: lead.name, email: lead.email }} emails={data.emails} zohoConnected={data.zohoConnected} />
        )}
      </div>
    </div>
  );
}

function WrapUp({ call, categories, run, pending }: { call: PanelData["calls"][number]; categories: PanelData["categories"]; run: Run; pending: boolean }) {
  const [categoryId, setCategoryId] = useState(call.categoryId ?? "");
  const [remark, setRemark] = useState(call.remark ?? "");
  const dirty = categoryId !== (call.categoryId ?? "") || remark !== (call.remark ?? "");
  return (
    <form
      className="mt-2 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => wrapUpCall({ callId: call.id, categoryId, remark }), "Call updated");
      }}
    >
      <label className="sr-only" htmlFor={`cat-${call.id}`}>
        Call category
      </label>
      <select id={`cat-${call.id}`} className="input w-auto text-[12px]" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
        <option value="">What was this call about?</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor={`rem-${call.id}`}>
        Remark
      </label>
      <input
        id={`rem-${call.id}`}
        className="input min-w-[160px] flex-1 text-[12px]"
        placeholder="Remark (optional)"
        maxLength={1000}
        value={remark}
        onChange={(e) => setRemark(e.target.value)}
      />
      <button className="btn btn-primary btn-sm" disabled={pending || !dirty}>
        Save
      </button>
    </form>
  );
}

function CallsTab({ data, run, pending }: { data: PanelData; run: Run; pending: boolean }) {
  if (!data.calls.length) {
    return <p className="text-[13px] text-muted">No calls with this number yet. Press Call to start. Calls appear here as Smartflo reports them.</p>;
  }
  const label = (id: string | null) => data.categories.find((c) => c.id === id)?.label ?? null;
  return (
    <ul className="grid gap-3">
      {data.calls.map((c) => (
        <li key={c.id} className="rounded-[12px] border border-line bg-alt p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-[13px] font-semibold">
              {c.direction === "outbound" ? <ArrowUpRight className="h-4 w-4 text-primary" /> : <ArrowDownLeft className="h-4 w-4 text-primary" />}
              {c.when}
              <span className="font-normal text-muted capitalize">· {c.direction}</span>
            </span>
            <span className="flex items-center gap-2">
              <CallStatusPill status={c.status} />
              {c.status === "answered" && <span className="tabular-nums text-[12px] text-muted">{c.duration}</span>}
            </span>
          </div>
          <dl className="mt-1.5 grid gap-x-4 gap-y-0.5 text-[12px] text-muted sm:grid-cols-2">
            {c.outcome && c.outcome !== "Answered" && (
              <div>
                Result: <span className="text-ink">{c.outcome}</span>
              </div>
            )}
            {label(c.categoryId) && (
              <div>
                Category: <span className="text-ink">{label(c.categoryId)}</span>
                {c.categorySource === "ivr" ? " (IVR key)" : c.categorySource === "agent" ? " (set by agent)" : ""}
              </div>
            )}
            {c.agentName && (
              <div>
                Agent: <span className="text-ink">{c.agentName}</span>
              </div>
            )}
            {c.disposition && (
              <div>
                Disposition: <span className="text-ink">{c.disposition}</span>
              </div>
            )}
          </dl>
          {c.status !== "ongoing" && <WrapUp call={c} categories={data.categories} run={run} pending={pending} />}
          {c.hasRecording ? (
            <RecordingPlayer className="mt-2" callId={c.id} duration={c.duration} />
          ) : (
            c.status === "answered" && <p className="mt-2 text-[12px] text-muted">No recording available for this call.</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function DetailsTab({ data, run, pending }: { data: PanelData; run: Run; pending: boolean }) {
  const { lead } = data;
  const [form, setForm] = useState({
    name: lead.name,
    email: lead.email ?? "",
    company: lead.company ?? "",
    memberCode: lead.memberCode ?? "",
    categoryId: lead.categoryId ?? "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const extra = Object.entries(lead.extra);
  return (
    <div className="grid gap-5">
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => updateLeadDetails(lead.id, form), "Details saved");
        }}
      >
        {(
          [
            ["name", "Name"],
            ["email", "Email"],
            ["company", "Organisation"],
            ["memberCode", "Member code"],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="grid gap-1 ivr-label">
            {label}
            <input className="input font-normal text-ink" value={form[k]} onChange={set(k)} />
          </label>
        ))}
        <label className="grid gap-1 ivr-label sm:col-span-2">
          Purpose of the outreach (default category for calls)
          <select className="input font-normal text-ink" value={form.categoryId} onChange={set("categoryId")}>
            <option value="">None</option>
            {data.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <div className="sm:col-span-2">
          <button className="btn btn-primary btn-sm" disabled={pending}>
            Save details
          </button>
        </div>
      </form>
      <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-muted">Source</dt>
        <dd>{lead.source ?? "–"}</dd>
        <dt className="text-muted">Created</dt>
        <dd>{lead.createdAt}</dd>
        {extra.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {data.history.length > 0 && (
        <div>
          <h3 className="mb-1.5 font-sans text-[12px] font-semibold tracking-wide text-muted uppercase">History</h3>
          <ul className="grid gap-1 text-[12.5px]">
            {data.history.map((h, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-32 shrink-0 text-muted">{h.when}</span>
                <span>{h.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function NotesTab({ data, run, pending }: { data: PanelData; run: Run; pending: boolean }) {
  const [body, setBody] = useState("");
  return (
    <div className="grid gap-4">
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveNote(data.lead.id, body), "Note saved");
          setBody("");
        }}
      >
        <label className="sr-only" htmlFor="note-body">
          Note
        </label>
        <textarea
          id="note-body"
          className="input min-h-24"
          placeholder="Anything worth remembering about this member"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex justify-end">
          <button className="btn btn-primary" disabled={pending || !body.trim()}>
            Save note
          </button>
        </div>
      </form>
      {data.notes.length === 0 ? (
        <p className="text-[13px] text-muted">No notes yet.</p>
      ) : (
        <ul className="grid gap-2">
          {data.notes.map((n) => (
            <li key={n.id} className="rounded-[12px] border border-line bg-alt p-4">
              <p className="text-[13px] whitespace-pre-wrap">{n.body}</p>
              <p className="mt-1 text-[11px] text-muted">
                {n.by ?? "Unknown"} · {n.when}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
