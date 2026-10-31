"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { cx as clsx } from "@/lib/ivr/cx";

type Agent = { id: string; name: string };
type SectionKey = "summary" | "agents" | "charts" | "categories" | "numbers" | "assignments" | "calls";

const SECTIONS: { key: SectionKey; label: string; hint: string }[] = [
  { key: "summary", label: "KPI summary", hint: "Calls, answer rate, members called, talk time, inbound against outbound" },
  { key: "agents", label: "Per-agent table", hint: "One row per agent with pick-up rate and talk time" },
  { key: "charts", label: "Charts", hint: "Calls per day, pick-up rate by agent, members by stage" },
  { key: "categories", label: "Calls by category", hint: "Membership, proforma, hall booking and the rest" },
  { key: "numbers", label: "Answer rate by number", hint: "The 60 most-called numbers" },
  { key: "assignments", label: "Allocated and reallocated members", hint: "Who received and who gave up members" },
  { key: "calls", label: "Full call list", hint: "Newest 2,000 calls in the period" },
];

const addDaysStr = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

type Preset = "week" | "month" | "this-month" | "last-month" | "custom";

function presetRange(p: Preset, today: string): { from: string; to: string } | null {
  if (p === "week") return { from: addDaysStr(today, -6), to: today };
  if (p === "month") return { from: addDaysStr(today, -29), to: today };
  if (p === "this-month") return { from: `${today.slice(0, 7)}-01`, to: today };
  if (p === "last-month") {
    const first = `${today.slice(0, 7)}-01`;
    const lastDay = addDaysStr(first, -1);
    return { from: `${lastDay.slice(0, 7)}-01`, to: lastDay };
  }
  return null;
}

const PRESETS: { key: Preset; label: string }[] = [
  { key: "week", label: "Last 7 days" },
  { key: "month", label: "Last 30 days" },
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "custom", label: "Custom" },
];

export function ReportBuilder({
  agents,
  today,
  initialFrom,
  initialTo,
}: {
  agents: Agent[];
  today: string;
  initialFrom: string;
  initialTo: string;
}) {
  const [preset, setPreset] = useState<Preset>("custom");
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [all, setAll] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [sections, setSections] = useState<Set<SectionKey>>(new Set(["summary", "agents", "charts", "assignments"]));

  const validDates = !!from && !!to && from <= to;
  const ready = validDates && sections.size > 0 && (all || picked.size > 0);
  const href = useMemo(() => {
    const q = new URLSearchParams({
      from,
      to,
      scope: all ? "all" : [...picked].join(","),
      sections: [...sections].join(","),
    });
    return `/api/ivr/reports/pdf?${q.toString()}`;
  }, [from, to, all, picked, sections]);

  const scopeText = all ? "All agents" : picked.size ? agents.filter((a) => picked.has(a.id)).map((a) => a.name).join(", ") : "No agents selected";

  function choose(p: Preset) {
    setPreset(p);
    const r = presetRange(p, today);
    if (r) {
      setFrom(r.from);
      setTo(r.to);
    }
  }

  function toggle<T>(set: Set<T>, v: T, apply: (s: Set<T>) => void) {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    apply(next);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
      <div className="ivr-card grid gap-6 p-6 sm:p-8">
        <fieldset className="grid gap-2">
          <legend className="mb-1 ivr-label">Period</legend>
          <div role="group" aria-label="Period presets" className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={preset === p.key}
                onClick={() => choose(p.key)}
                className={clsx("ivr-chip px-3.5 py-1.5 text-[0.82rem]!", preset === p.key && "ivr-chip-on")}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 ivr-label" htmlFor="rb-from">
              From
              <input id="rb-from" type="date" className="input" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }} />
            </label>
            <label className="grid gap-1 ivr-label" htmlFor="rb-to">
              To
              <input id="rb-to" type="date" className="input" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPreset("custom"); }} />
            </label>
          </div>
          {!validDates && <p className="text-[0.78rem] text-brand-red">Choose a start date that is on or before the end date.</p>}
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="mb-1 ivr-label">Agents</legend>
          <label className="flex items-center gap-2 text-[13px]" htmlFor="rb-all">
            <input id="rb-all" type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            All agents
          </label>
          {!all && (
            <div className="grid gap-1.5 rounded-[12px] border border-line bg-[var(--ivr-surface-2)] p-4 sm:grid-cols-2">
              {agents.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-[13px]" htmlFor={`rb-a-${a.id}`}>
                  <input id={`rb-a-${a.id}`} type="checkbox" checked={picked.has(a.id)} onChange={() => toggle(picked, a.id, setPicked)} />
                  {a.name}
                </label>
              ))}
              {!agents.length && <p className="text-[13px] text-muted">No active agents yet.</p>}
            </div>
          )}
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="mb-1 ivr-label">Include</legend>
          {SECTIONS.map((s) => (
            <label key={s.key} className="flex items-start gap-2 text-[13px]" htmlFor={`rb-s-${s.key}`}>
              <input id={`rb-s-${s.key}`} className="mt-1" type="checkbox" checked={sections.has(s.key)} onChange={() => toggle(sections, s.key, setSections)} />
              <span>
                {s.label}
                <span className="block text-[12px] text-muted">{s.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="flex flex-wrap items-center gap-3">
          {ready ? (
            <a className="btn btn-primary" href={href} download>
              <Download className="h-4 w-4" />
              Download PDF
            </a>
          ) : (
            <button className="btn btn-primary" disabled>
              <Download className="h-4 w-4" />
              Download PDF
            </button>
          )}
          <p className="text-[12px] text-muted">The file is built when you click, from the same numbers as the dashboards.</p>
        </div>
      </div>

      <Paper from={from} to={to} scope={scopeText} sections={sections} />
    </div>
  );
}

/** A paper-style preview of the pages the selection will produce. It shows structure, not figures. */
function Paper({ from, to, scope, sections }: { from: string; to: string; scope: string; sections: Set<SectionKey> }) {
  const bar = (w: string, o = 1) => <div style={{ width: w, opacity: o, height: 8, borderRadius: 2, background: "#2A6B7C" }} />;
  const rule = <div style={{ height: 1, background: "#E2E8F0" }} />;
  const line = (w: string) => <div style={{ width: w, height: 5, borderRadius: 2, background: "#E2E8F0" }} />;
  return (
    <div aria-label="Report preview" className="self-start" style={{ background: "#ffffff", color: "#0F172A", border: "1px solid #E2E8F0", borderRadius: 12, padding: 20, display: "grid", gap: 10, fontSize: 11, boxShadow: "var(--ivr-shadow-card)" }}>
      <b style={{ fontFamily: "var(--ivr-font-display)", fontSize: 15 }}>Membership report</b>
      <span>
        {from || "…"} to {to || "…"} · {scope}
      </span>
      {rule}
      {sections.has("summary") && (
        <div className="grid gap-1.5">
          <span style={{ fontWeight: 600 }}>KPI summary</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ border: "1px solid #d8d8d8", borderRadius: 8, padding: 6, display: "grid", gap: 4 }}>
                {line("60%")}
                {bar("40%")}
              </div>
            ))}
          </div>
        </div>
      )}
      {sections.has("agents") && (
        <div className="grid gap-1.5">
          <span style={{ fontWeight: 600 }}>Agents</span>
          {line("100%")}
          {line("92%")}
          {line("96%")}
        </div>
      )}
      {sections.has("charts") && (
        <div className="grid gap-1.5">
          <span style={{ fontWeight: 600 }}>Charts</span>
          {bar("78%")}
          {bar("62%", 0.6)}
          {bar("45%", 0.4)}
        </div>
      )}
      {sections.has("categories") && (
        <div className="grid gap-1.5">
          <span style={{ fontWeight: 600 }}>Calls by category</span>
          {line("100%")}
          {line("88%")}
        </div>
      )}
      {sections.has("numbers") && (
        <div className="grid gap-1.5">
          <span style={{ fontWeight: 600 }}>Answer rate by number</span>
          {line("100%")}
          {line("94%")}
          {line("97%")}
        </div>
      )}
      {sections.has("assignments") && (
        <div className="grid gap-1.5">
          <span style={{ fontWeight: 600 }}>Allocations and reallocations</span>
          {line("80%")}
          {line("70%")}
        </div>
      )}
      {sections.has("calls") && (
        <div className="grid gap-1.5">
          <span style={{ fontWeight: 600 }}>Call list (separate pages)</span>
          {line("100%")}
          {line("95%")}
          {line("98%")}
        </div>
      )}
      {!sections.size && <span style={{ color: "#64748B" }}>Choose at least one section.</span>}
    </div>
  );
}
