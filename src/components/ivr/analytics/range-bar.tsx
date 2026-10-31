"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cx as clsx } from "@/lib/ivr/cx";

type Agent = { id: string; name: string };
export type RangeState = {
  range: "today" | "week" | "month" | "custom";
  from: string;
  to: string;
  scope: string;
  compare: string;
  category: string;
  direction: "" | "inbound" | "outbound";
};

const PRESETS: { key: RangeState["range"]; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "7 days" },
  { key: "month", label: "30 days" },
  { key: "custom", label: "Custom" },
];

/** Writes the analytics filters into the URL so every view is linkable and the server does the work. */
export function RangeBar({ agents, categories, state }: { agents: Agent[]; categories: { id: string; label: string }[]; state: RangeState }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [from, setFrom] = useState(state.from);
  const [to, setTo] = useState(state.to);

  function go(patch: Partial<RangeState>) {
    const next = { ...state, ...patch };
    const q = new URLSearchParams();
    q.set("range", next.range);
    if (next.range === "custom" && next.from && next.to) {
      q.set("from", next.from);
      q.set("to", next.to);
    }
    if (next.scope && next.scope !== "team") q.set("scope", next.scope);
    if (next.scope && next.scope !== "team" && next.compare) q.set("compare", next.compare);
    if (next.category) q.set("category", next.category);
    if (next.direction) q.set("direction", next.direction);
    start(() => router.push(`${pathname}?${q.toString()}`));
  }

  const scopeIsUser = state.scope !== "team";
  return (
    <div className="ivr-card flex flex-wrap items-end gap-x-5 gap-y-3 p-4" aria-busy={pending}>
      <div role="group" aria-label="Period" className="flex gap-1 rounded-[12px] border border-line p-1">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            aria-pressed={state.range === p.key}
            onClick={() => (p.key === "custom" ? go({ range: "custom", from: from || state.from, to: to || state.to }) : go({ range: p.key }))}
            className={clsx(
              "rounded-[8px] px-3.5 py-1.5 text-[0.82rem] font-medium transition-colors",
              state.range === p.key ? "bg-[var(--ivr-tint-blue)] font-semibold text-primary" : "text-muted hover:bg-[var(--ivr-tint-blue)] hover:text-primary",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {state.range === "custom" && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (from && to) go({ range: "custom", from, to });
          }}
        >
          <label className="grid gap-1 ivr-label" htmlFor="an-from">
            From
            <input id="an-from" type="date" className="input" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} required />
          </label>
          <label className="grid gap-1 ivr-label" htmlFor="an-to">
            To
            <input id="an-to" type="date" className="input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} required />
          </label>
          <button type="submit" className="btn btn-primary btn-sm">
            Apply
          </button>
        </form>
      )}

      <label className="grid gap-1 ivr-label" htmlFor="an-scope">
        Agent
        <select
          id="an-scope"
          className="input min-w-40"
          value={state.scope}
          onChange={(e) => go({ scope: e.target.value, compare: "" })}
        >
          <option value="team">Whole team</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1 ivr-label" htmlFor="an-category">
        Category
        <select id="an-category" className="input min-w-40" value={state.category} onChange={(e) => go({ category: e.target.value })}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1 ivr-label" htmlFor="an-direction">
        Direction
        <select
          id="an-direction"
          className="input min-w-36"
          value={state.direction}
          onChange={(e) => go({ direction: e.target.value as RangeState["direction"] })}
        >
          <option value="">Inbound and outbound</option>
          <option value="outbound">Outbound only</option>
          <option value="inbound">Inbound only</option>
        </select>
      </label>

      {scopeIsUser && (
        <label className="grid gap-1 ivr-label" htmlFor="an-compare">
          Compare with
          <select id="an-compare" className="input min-w-40" value={state.compare} onChange={(e) => go({ compare: e.target.value })}>
            <option value="">No one</option>
            {agents
              .filter((a) => a.id !== state.scope)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
      )}

      <p className="ml-auto text-[12px] text-muted" aria-live="polite">
        {pending ? "Updating…" : `${state.from} to ${state.to}`}
      </p>
    </div>
  );
}
