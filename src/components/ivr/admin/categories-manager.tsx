"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveAllocationRule, saveCategory, saveRetry } from "@/lib/ivr/actions/categories";
import { Alert } from "@/components/ivr/ui";

export type CategoryDTO = {
  id: string;
  label: string;
  appliesTo: "inbound" | "outbound" | "both";
  ivrKey: string | null;
  active: boolean;
  agentIds: string[];
};

type Msg = { ok: boolean; text: string } | null;
type Result = { ok: boolean; error?: string; message?: string };

function useRunner() {
  const router = useRouter();
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.ok ? (r.message ?? "Saved") : (r.error ?? "Something went wrong") });
      if (r.ok) {
        after?.();
        router.refresh();
      }
    });
  return { msg, pending, run };
}

function CategoryRow({ c, agents }: { c: CategoryDTO; agents: { id: string; name: string }[] }) {
  const { msg, pending, run } = useRunner();
  const [label, setLabel] = useState(c.label);
  const [appliesTo, setAppliesTo] = useState(c.appliesTo);
  const [ivrKey, setIvrKey] = useState(c.ivrKey ?? "");
  const [active, setActive] = useState(c.active);
  const [chosen, setChosen] = useState<Set<string>>(new Set(c.agentIds));
  const [showAgents, setShowAgents] = useState(false);

  return (
    <li className="grid gap-3 border-b border-line px-5 py-4 last:border-b-0">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveCategory({ id: c.id, label, appliesTo, ivrKey, active }));
        }}
      >
        <label className="grid gap-1 ivr-label">
          Name
          <input className="input w-56 font-normal text-ink" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="grid gap-1 ivr-label">
          Used for
          <select className="input w-auto font-normal text-ink" value={appliesTo} onChange={(e) => setAppliesTo(e.target.value as CategoryDTO["appliesTo"])}>
            <option value="both">Inbound and outbound</option>
            <option value="outbound">Outbound only</option>
            <option value="inbound">Inbound only</option>
          </select>
        </label>
        <label className="grid gap-1 ivr-label">
          IVR key
          <input className="input w-20 font-normal text-ink" value={ivrKey} maxLength={1} disabled={appliesTo === "outbound"} onChange={(e) => setIvrKey(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 pb-2 text-[13px]">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
        </label>
        <button className="btn btn-primary btn-sm" disabled={pending}>
          Save
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAgents((s) => !s)} aria-expanded={showAgents}>
          Agents{chosen.size ? ` (${chosen.size})` : ""}
        </button>
      </form>
      {showAgents && (
        <div className="grid gap-2 rounded-[12px] border border-line bg-alt p-4">
          <p className="text-[12px] text-muted">
            Imported members of this category with no agent in the file go to these agents, shared evenly. Leave empty for no rule.
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            {agents.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={chosen.has(a.id)}
                  onChange={(e) =>
                    setChosen((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(a.id);
                      else n.delete(a.id);
                      return n;
                    })
                  }
                />
                {a.name}
              </label>
            ))}
            {agents.length === 0 && <span className="text-[13px] text-muted">No active agents yet.</span>}
          </div>
          <div>
            <button className="btn btn-primary btn-sm" disabled={pending} onClick={() => run(() => saveAllocationRule(c.id, [...chosen]))}>
              Save allocation
            </button>
          </div>
        </div>
      )}
      {msg && (
        <Alert kind={msg.ok ? "success" : "error"} role={msg.ok ? "status" : "alert"} className="px-3 py-2 text-[0.8rem]">
          {msg.text}
        </Alert>
      )}
    </li>
  );
}

function AddCategory() {
  const { msg, pending, run } = useRunner();
  const [label, setLabel] = useState("");
  const [appliesTo, setAppliesTo] = useState<CategoryDTO["appliesTo"]>("both");
  const [ivrKey, setIvrKey] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-3 px-5 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => saveCategory({ label, appliesTo, ivrKey, active: true }),
          () => {
            setLabel("");
            setIvrKey("");
          },
        );
      }}
    >
      <label className="grid gap-1 ivr-label">
        New category
        <input className="input w-56 font-normal text-ink" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Sponsorship enquiry" />
      </label>
      <label className="grid gap-1 ivr-label">
        Used for
        <select className="input w-auto font-normal text-ink" value={appliesTo} onChange={(e) => setAppliesTo(e.target.value as CategoryDTO["appliesTo"])}>
          <option value="both">Inbound and outbound</option>
          <option value="outbound">Outbound only</option>
          <option value="inbound">Inbound only</option>
        </select>
      </label>
      <label className="grid gap-1 ivr-label">
        IVR key
        <input className="input w-20 font-normal text-ink" value={ivrKey} maxLength={1} disabled={appliesTo === "outbound"} onChange={(e) => setIvrKey(e.target.value)} />
      </label>
      <button className="btn btn-primary btn-sm" disabled={pending || label.trim().length < 2}>
        Add
      </button>
      {msg && (
        <Alert kind={msg.ok ? "success" : "error"} role={msg.ok ? "status" : "alert"} className="w-full px-3 py-2 text-[0.8rem]">
          {msg.text}
        </Alert>
      )}
    </form>
  );
}

function RetryForm({ initial }: { initial: { maxAttempts: number; minGapHours: number } }) {
  const { msg, pending, run } = useRunner();
  const [max, setMax] = useState(String(initial.maxAttempts));
  const [gap, setGap] = useState(String(initial.minGapHours));
  return (
    <form
      className="flex flex-wrap items-end gap-3 px-5 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveRetry({ maxAttempts: Number(max), minGapHours: Number(gap) }));
      }}
    >
      <label className="grid gap-1 ivr-label">
        Maximum tries per member
        <input className="input w-28 font-normal text-ink" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} />
      </label>
      <label className="grid gap-1 ivr-label">
        Minimum gap between tries (hours)
        <input className="input w-28 font-normal text-ink" inputMode="numeric" value={gap} onChange={(e) => setGap(e.target.value)} />
      </label>
      <button className="btn btn-primary btn-sm" disabled={pending}>
        Save
      </button>
      {msg && (
        <Alert kind={msg.ok ? "success" : "error"} role={msg.ok ? "status" : "alert"} className="w-full px-3 py-2 text-[0.8rem]">
          {msg.text}
        </Alert>
      )}
    </form>
  );
}

export function CategoriesManager({
  categories,
  agents,
  retry,
}: {
  categories: CategoryDTO[];
  agents: { id: string; name: string }[];
  retry: { maxAttempts: number; minGapHours: number };
}) {
  return (
    <div className="grid gap-5">
      <section className="ivr-card overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-[1.1rem]">Call categories</h2>
          <p className="text-[0.8rem] text-muted">
            What a call is about. Outbound calls take the member&apos;s category from the import; inbound calls take it from the IVR menu key.
            Agents can change it after each call.
          </p>
        </div>
        <ul>
          {categories.map((c) => (
            <CategoryRow key={c.id} c={c} agents={agents} />
          ))}
        </ul>
        <div className="border-t border-line">
          <AddCategory />
        </div>
      </section>
      <section className="ivr-card overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-[1.1rem]">Retry rule</h2>
          <p className="text-[0.8rem] text-muted">
            Orders each agent&apos;s call queue. Members never called come first; after the maximum number of tries a member moves to &quot;Out of tries&quot;.
          </p>
        </div>
        <RetryForm initial={retry} />
      </section>
    </div>
  );
}
