"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cx as clsx } from "@/lib/ivr/cx";
import { assignLeadsAction } from "@/lib/ivr/actions/assign";
import { Alert } from "@/components/ivr/ui";

type Mode = "one" | "split" | "balanced";
type Agent = { id: string; name: string; open: number };
type Done = { count: number; perAgent: { name: string; count: number }[] };

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "split", label: "Split evenly across the agents I pick", hint: "Round-robin, in the order of the selection." },
  { value: "one", label: "Give all to one agent", hint: "Every selected lead goes to the same person." },
  { value: "balanced", label: "Balance by open workload", hint: "Agents with fewer open leads get more." },
];

export function BulkAssignDialog({
  leadIds,
  agents,
  onClose,
}: {
  leadIds: string[];
  agents: Agent[];
  onClose: () => void;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<Mode>("split");
  const [picked, setPicked] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => d?.close();
  }, []);

  const finish = () => {
    if (done) router.refresh();
    onClose();
  };

  const toggle = (id: string) => {
    setError(null);
    setPicked((cur) => {
      if (mode === "one") return cur[0] === id ? [] : [id];
      return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    });
  };

  const changeMode = (m: Mode) => {
    setMode(m);
    setPicked((cur) => (m === "one" ? cur.slice(0, 1) : cur));
  };

  const preview = useMemo(() => {
    const n = leadIds.length;
    const noun = `${n.toLocaleString()} lead${n === 1 ? "" : "s"}`;
    if (!picked.length) return `${noun} selected. Pick ${mode === "one" ? "an agent" : "one or more agents"}.`;
    if (mode === "one") return `${noun} → ${agents.find((a) => a.id === picked[0])?.name}`;
    const k = picked.length;
    const agentsText = `${k} agent${k === 1 ? "" : "s"}`;
    if (mode === "split") {
      const lo = Math.floor(n / k);
      const hi = Math.ceil(n / k);
      return `${noun} → ${agentsText} → ${lo === hi ? `${lo} each` : `${lo} to ${hi} each`}`;
    }
    return `${noun} → ${agentsText}, fewest open leads first`;
  }, [leadIds.length, picked, mode, agents]);

  const submit = () => {
    setError(null);
    start(async () => {
      const res = await assignLeadsAction({ leadIds, mode, agentIds: picked, reason: reason || undefined });
      if (res.ok) setDone({ count: res.count, perAgent: res.perAgent });
      else setError(res.error);
    });
  };

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) finish();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !pending) finish();
      }}
      aria-labelledby="bulk-assign-title"
      className="ivr-modal m-auto w-[min(560px,calc(100vw-2rem))]"
    >
      <div className="grid gap-5 p-6 sm:p-8">
        <div className="flex items-start justify-between gap-3">
          <h2 id="bulk-assign-title" className="text-2xl">
            {done ? "Leads assigned" : `Assign ${leadIds.length.toLocaleString()} lead${leadIds.length === 1 ? "" : "s"}`}
          </h2>
          <button className="btn btn-ghost btn-sm px-2.5" onClick={finish} disabled={pending} aria-label="Close">
            ✕
          </button>
        </div>

        {done ? (
          <div className="grid gap-3">
            <p className="text-[13px]">
              <b>{done.count.toLocaleString()}</b> lead{done.count === 1 ? "" : "s"} assigned. The history on each lead shows the change.
            </p>
            <ul className="grid gap-1 text-[13px]">
              {done.perAgent
                .filter((a) => a.count > 0)
                .map((a) => (
                  <li key={a.name} className="flex justify-between rounded-[8px] border border-line bg-alt px-3 py-2">
                    <span>{a.name}</span>
                    <span className="tabular-nums font-semibold">{a.count}</span>
                  </li>
                ))}
            </ul>
            <div className="flex justify-end">
              <button className="btn btn-primary" onClick={finish} autoFocus>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <fieldset className="grid gap-2" disabled={pending}>
              <legend className="sr-only">How to spread the leads</legend>
              {MODES.map((m) => (
                <label
                  key={m.value}
                  className={clsx(
                    "flex cursor-pointer items-start gap-2.5 rounded-[12px] border px-4 py-3 transition-colors duration-200",
                    mode === m.value ? "border-primary bg-[var(--ivr-tint-blue)]" : "border-line hover:border-[var(--ivr-line-hover)]",
                  )}
                >
                  <input
                    type="radio"
                    name="assign-mode"
                    className="mt-1 accent-[var(--ivr-accent)]"
                    checked={mode === m.value}
                    onChange={() => changeMode(m.value)}
                  />
                  <span className="text-[13px]">
                    {m.label}
                    <small className="block text-muted">{m.hint}</small>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="grid gap-1.5">
              <p className="ivr-label">
                {mode === "one" ? "Agent" : "Agents"} <span className="font-normal tracking-normal normal-case">(number of open leads)</span>
              </p>
              {agents.length ? (
                <div className="flex flex-wrap gap-2" role="group" aria-label="Agents">
                  {agents.map((a) => {
                    const on = picked.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        aria-pressed={on}
                        disabled={pending}
                        onClick={() => toggle(a.id)}
                        className={clsx(
                          "ivr-chip",
                          on && "ivr-chip-on",
                        )}
                      >
                        {a.name} · <span className="tabular-nums">{a.open}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[13px] text-muted">There are no active agents yet. Add users first.</p>
              )}
            </div>

            <p className="ivr-quote text-[0.85rem]" aria-live="polite">
              {preview}
            </p>

            <div className="grid gap-1.5">
              <label htmlFor="assign-reason" className="ivr-label">
                Reason <span className="font-normal tracking-normal normal-case">(optional, shown in the lead history)</span>
              </label>
              <input
                id="assign-reason"
                className="input"
                value={reason}
                maxLength={300}
                onChange={(e) => setReason(e.target.value)}
                placeholder="For example: Akshada on leave"
                disabled={pending}
              />
            </div>

            {error && <Alert kind="error">{error}</Alert>}

            <div className="flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={finish} disabled={pending}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={submit} disabled={pending || !picked.length}>
                {pending ? "Assigning…" : "Assign"}
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
