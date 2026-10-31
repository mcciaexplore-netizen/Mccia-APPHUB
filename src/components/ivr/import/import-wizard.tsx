"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { cx as clsx } from "@/lib/ivr/cx";
import { commitImport, previewImport, type CommitResult, type PreviewResult, type PreviewRow } from "@/lib/ivr/actions/import";
import { CountUp } from "@/components/ivr/count-up";
import { Alert } from "@/components/ivr/ui";
import { FIELDS, FIELD_LABELS, type FieldKey, type Mapping } from "@/lib/ivr/import/detect";

type Preview = Extract<PreviewResult, { ok: true }>;
type Committed = Extract<CommitResult, { ok: true }>;
type Filter = "all" | "attention" | "matched" | "ambiguous" | "unmatched" | "duplicates" | "invalid";

const STEPS = ["Upload", "Detect columns", "Allocate", "Review and save"];

const SOURCE_LABEL: Record<string, string> = {
  file: "Agent in file",
  choice: "Your choice",
  existing_owner: "Existing owner",
  category_rule: "Category rule",
  round_robin: "Shared evenly",
};

const METHOD_LABEL: Record<string, string> = {
  agent_id: "Agent ID",
  phone: "Agent phone",
  email: "Agent email",
  "email+name": "Email and name",
  name: "Agent name",
};

function Chip({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="ivr-pill" style={{ "--tone": color } as React.CSSProperties}>
      {children}
    </span>
  );
}

function rowResult(r: PreviewRow, chosen: string | undefined): { label: string; color: string } {
  if (!r.phone) return { label: "Rejected", color: "var(--ivr-missed)" };
  if (r.repeatOf) return { label: `Repeat of row ${r.repeatOf}`, color: "var(--ivr-muted)" };
  if (r.status === "matched" || r.allocUserId || (chosen && chosen !== "")) {
    return r.duplicate ? { label: "Existing member", color: "var(--ivr-sched)" } : { label: "Will be assigned", color: "var(--ivr-done)" };
  }
  if (r.status === "ambiguous") return { label: "Needs a choice", color: "var(--ivr-incoming)" };
  return r.duplicate ? { label: "Existing member", color: "var(--ivr-sched)" } : { label: "Unassigned", color: "var(--ivr-missed)" };
}

export function ImportWizard() {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<null | "preview" | "commit">(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<Filter>("attention");
  const [unmatched, setUnmatched] = useState<"pool" | "skip">("pool");
  const [duplicates, setDuplicates] = useState<"update" | "skip">("update");
  const [reassign, setReassign] = useState(false);
  const [result, setResult] = useState<Committed | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [bulkAgent, setBulkAgent] = useState("");
  const [defaultCategory, setDefaultCategory] = useState("");
  const [roundRobin, setRoundRobin] = useState(false);
  const [rrAgents, setRrAgents] = useState<Set<string> | null>(null); // null = every agent
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep(1);
    setFile(null);
    setPreview(null);
    setMapping(null);
    setChoices({});
    setResult(null);
    setError(null);
    setFilter("attention");
    if (inputRef.current) inputRef.current.value = "";
  };

  function addAllocation(fd: FormData) {
    if (defaultCategory) fd.set("defaultCategory", defaultCategory);
    if (roundRobin) {
      fd.set("roundRobin", "1");
      const ids = rrAgents ? [...rrAgents] : (preview?.agents ?? []).map((a) => a.id);
      fd.set("rrAgents", JSON.stringify(ids));
    }
  }

  async function runPreview(f: File, m: Mapping | null) {
    setBusy("preview");
    setError(null);
    const fd = new FormData();
    fd.set("file", f);
    if (m) fd.set("mapping", JSON.stringify(m));
    addAllocation(fd);
    try {
      const res = await previewImport(fd);
      if (!res.ok) {
        setError(res.error);
        return null;
      }
      setPreview(res);
      setMapping(res.mapping);
      return res;
    } catch {
      setError("The file could not be sent. Check your connection and try again.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function onFile(f: File | null | undefined) {
    if (!f) return;
    setFile(f);
    setChoices({});
    const res = await runPreview(f, null);
    if (res) setStep(2);
  }

  async function recheck() {
    if (!file || !mapping) return;
    setChoices({});
    const res = await runPreview(file, mapping);
    if (res) setStep(3);
  }

  async function save() {
    if (!file || !mapping) return;
    setBusy("commit");
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("mapping", JSON.stringify(mapping));
    fd.set("choices", JSON.stringify(choices));
    fd.set("unmatched", unmatched);
    fd.set("duplicates", duplicates);
    if (reassign) fd.set("reassign", "1");
    addAllocation(fd);
    try {
      const res = await commitImport(fd);
      if (res.ok) setResult(res);
      else setError(res.error);
    } catch {
      setError("Saving failed. Nothing was lost; try again.");
    } finally {
      setBusy(null);
    }
  }

  const needChoice = useMemo(
    () => (preview?.rows ?? []).filter((r) => r.phone && !r.repeatOf && r.status === "ambiguous" && !choices[String(r.rowNumber)]).length,
    [preview, choices],
  );

  const visibleRows = useMemo(() => {
    const rows = preview?.rows ?? [];
    switch (filter) {
      case "all":
        return rows;
      case "attention":
        return rows.filter((r) => (r.status !== "matched" && !r.allocUserId) || r.duplicate || r.repeatOf || r.problem);
      case "duplicates":
        return rows.filter((r) => r.duplicate || r.repeatOf);
      case "invalid":
        return rows.filter((r) => !r.phone);
      case "matched":
        return rows.filter((r) => r.phone && (r.status === "matched" || r.allocUserId));
      case "unmatched":
        return rows.filter((r) => r.phone && r.status === "unmatched" && !r.allocUserId);
      default:
        return rows.filter((r) => r.phone && r.status === filter);
    }
  }, [preview, filter]);

  const stepper = (
    <ol className="flex flex-wrap gap-1.5" aria-label="Import steps">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = result ? "done" : n < step ? "done" : n === step ? "on" : "todo";
        return (
          <li
            key={label}
            aria-current={state === "on" ? "step" : undefined}
            className={clsx(
              "rounded-full border px-3.5 py-1.5 text-[0.75rem] font-semibold transition-colors duration-200",
              state === "on" && "border-primary bg-[var(--ivr-tint-blue)] text-primary",
              state === "done" && "border-[var(--ivr-tint-green-line)] bg-[var(--ivr-tint-green)] text-brand-green-text",
              state === "todo" && "border-line text-subtle",
            )}
          >
            {n} {label}
          </li>
        );
      })}
    </ol>
  );

  if (result) {
    const stats: [string, number][] = [
      ["New members", result.created],
      ["Existing members updated", result.updated],
      ["Assigned to agents", result.assigned],
      ["Left in the unassigned pool", result.pooled],
      ["Skipped as duplicates", result.skippedDuplicates],
      ["Skipped, no agent", result.skippedUnmatched],
      ["Rejected, no phone", result.invalid],
    ];
    return (
      <div className="ivr-card grid gap-5 p-6 sm:p-8">
        {stepper}
        <div>
          <h2 className="text-2xl">Import saved</h2>
          <p className="text-[13px] text-muted">{file?.name}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map(([label, n]) => (
            <div key={label} className="ivr-stat px-3 py-4">
              <p className="ivr-stat-number">
                <CountUp value={n} />
              </p>
              <p className="mt-1 text-[0.78rem] text-muted">{label}</p>
            </div>
          ))}
        </div>
        {Object.keys(result.bySource).length > 0 && (
          <p className="text-[13px] text-muted">
            Allocated by:{" "}
            {Object.entries(result.bySource)
              .map(([k, n]) => `${SOURCE_LABEL[k] ?? k} ${n}`)
              .join(" · ")}
            . Each agent sees their members in the Call queue.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Link href="/ivr/admin/members" className="btn btn-primary">
            View members
          </Link>
          {result.pooled > 0 && (
            <Link href="/ivr/admin/members?unassigned=1" className="btn btn-ghost">
              Open the unassigned pool ({result.pooled.toLocaleString()})
            </Link>
          )}
          <button className="btn btn-ghost" onClick={reset}>
            Import another file
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ivr-card grid gap-5 p-6 sm:p-8">
      {stepper}

      {error && (
        <Alert kind="error">{error}</Alert>
      )}

      {step === 1 && (
        <div className="grid gap-3">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void onFile(e.dataTransfer.files?.[0]);
            }}
            className={clsx(
              "grid place-items-center gap-2 rounded-[20px] border-2 border-dashed px-6 py-14 text-center transition-colors duration-300",
              dragOver ? "border-primary bg-[var(--ivr-tint-blue)]" : "border-line bg-[var(--ivr-surface-2)]",
            )}
          >
            <p className="font-heading text-xl font-bold">{busy === "preview" ? "Reading the file…" : "Drop your calling list (Excel or CSV) here"}</p>
            <p className="max-w-md text-[13px] text-muted">
              .xlsx or .csv, up to 2.5 MB and 20,000 rows. The first row must be the column headings. If the file has an agent column (email, phone, name or Smartflo ID), each member goes to that agent; otherwise the rules you set in the next step decide.
            </p>
            <label className="btn btn-primary cursor-pointer">
              Choose file
              <input
                ref={inputRef}
                id="import-file"
                type="file"
                accept=".csv,.xlsx"
                className="sr-only"
                disabled={busy !== null}
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </label>
          </div>
          <a href="/api/ivr/import/sample" className="w-fit text-[13px] font-medium text-primary underline underline-offset-2">
            Download a sample CSV
          </a>
        </div>
      )}

      {step === 2 && preview && mapping && (
        <div className="grid gap-4">
          <div>
            <h2 className="text-lg font-bold">Check the columns</h2>
            <p className="text-[13px] text-muted">
              {file?.name} · {preview.summary.total.toLocaleString()} rows. We matched each field to a column. Change any that look wrong.
            </p>
          </div>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[620px] border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="ivr-th">Field</th>
                  <th className="ivr-th">Column in your file</th>
                  <th className="ivr-th">Example</th>
                  <th className="ivr-th">Detected</th>
                </tr>
              </thead>
              <tbody>
                {FIELDS.map((f: FieldKey) => {
                  const col = mapping[f];
                  const conf = preview.confidence[f];
                  const meta = FIELD_LABELS[f];
                  return (
                    <tr key={f}>
                      <td className="ivr-td">
                        <label htmlFor={`map-${f}`} className="font-semibold">
                          {meta.label}
                          {meta.required && <span className="text-brand-red"> *</span>}
                        </label>
                        <p className="text-[12px] text-muted">{meta.hint}</p>
                      </td>
                      <td className="ivr-td">
                        <select
                          id={`map-${f}`}
                          className="input"
                          value={col === null ? "" : String(col)}
                          onChange={(e) => {
                            const v = e.target.value === "" ? null : Number(e.target.value);
                            setMapping((m) => {
                              if (!m) return m;
                              const next = { ...m };
                              // a column can feed only one field
                              if (v !== null) for (const k of FIELDS) if (next[k] === v) next[k] = null;
                              next[f] = v;
                              return next;
                            });
                          }}
                        >
                          <option value="">Not in my file</option>
                          {preview.columns.map((c, i) => (
                            <option key={i} value={i}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="ivr-td max-w-[220px] truncate text-muted">{col !== null ? preview.sample[0]?.[col] || "–" : "–"}</td>
                      <td className="ivr-td">
                        {col === null ? (
                          <Chip color="var(--ivr-muted)">Not found</Chip>
                        ) : conf >= 0.85 ? (
                          <Chip color="var(--ivr-done)">Sure</Chip>
                        ) : conf >= 0.5 ? (
                          <Chip color="var(--ivr-incoming)">Likely</Chip>
                        ) : (
                          <Chip color="var(--ivr-missed)">Guess</Chip>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {(() => {
            const used = new Set(Object.values(mapping).filter((v): v is number => v !== null));
            const extra = preview.columns.filter((_, i) => !used.has(i));
            return extra.length ? (
              <p className="text-[12.5px] text-muted">
                Not used for a field, kept on each lead as extra details: <span className="text-ink">{extra.join(", ")}</span>
              </p>
            ) : null;
          })()}
          <fieldset className="grid gap-3 rounded-[12px] border border-line bg-alt p-4">
            <legend className="ivr-label px-1">Allocation for rows with no agent in the file</legend>
            <p className="text-[12.5px] text-muted">
              Order used: the agent named in the file, then the member&apos;s current owner, then the category rule (set under Categories), then sharing evenly if you tick it below.
            </p>
            <label className="grid max-w-sm gap-1 text-[13px]">
              <span className="font-semibold">Category for rows that do not name one</span>
              <select className="input" value={defaultCategory} onChange={(e) => setDefaultCategory(e.target.value)}>
                <option value="">No default category</option>
                {preview.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={roundRobin} onChange={(e) => setRoundRobin(e.target.checked)} />
              Share the remaining members evenly across agents (least busy first)
            </label>
            {roundRobin && (
              <div className="flex flex-wrap gap-x-5 gap-y-1.5 pl-6">
                {preview.agents.map((a) => {
                  const on = rrAgents ? rrAgents.has(a.id) : true;
                  return (
                    <label key={a.id} className="flex items-center gap-2 text-[13px]">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) =>
                          setRrAgents((cur) => {
                            const n = new Set(cur ?? preview.agents.map((x) => x.id));
                            if (e.target.checked) n.add(a.id);
                            else n.delete(a.id);
                            return n;
                          })
                        }
                      />
                      {a.name}
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>
          {mapping.phone === null && <p className="text-[13px] text-brand-red">Choose the phone column to continue. Phone numbers are how duplicates are found.</p>}
          <div className="flex justify-between gap-2">
            <button className="btn btn-ghost" onClick={reset} disabled={busy !== null}>
              Choose another file
            </button>
            <button className="btn btn-primary" onClick={() => void recheck()} disabled={busy !== null || mapping.phone === null}>
              {busy === "preview" ? "Allocating…" : "Allocate members"}
            </button>
          </div>
        </div>
      )}

      {step === 3 && preview && (
        <div className="grid gap-4">
          <div>
            <h2 className="text-lg font-bold">Allocate members</h2>
            <p className="text-[13px] text-muted">
              Each row goes to the agent named in the file (found by ID, phone, email, then name), else the rules from the last step. A shared email is never guessed, so those rows ask you.
            </p>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter rows">
            {(
              [
                ["attention", "Needs attention", null, "var(--ivr-fg)"],
                ["matched", "Allocated", preview.summary.matched, "var(--ivr-done)"],
                ["ambiguous", "Need a choice", preview.summary.ambiguous, "var(--ivr-incoming)"],
                ["unmatched", "Nobody found", preview.summary.unmatched, "var(--ivr-missed)"],
                ["duplicates", "Duplicates", preview.summary.duplicates, "var(--ivr-sched)"],
                ["invalid", "No phone", preview.summary.invalid, "var(--ivr-missed)"],
                ["all", "All shown", null, "var(--ivr-fg)"],
              ] as [Filter, string, number | null, string][]
            ).map(([key, label, n, color]) => (
              <button
                key={key}
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                className={clsx(
                  "ivr-chip rounded-full!",
                  filter === key && "ivr-chip-on",
                )}
                style={{ color }}
              >
                {label}
                {n !== null && <span className="tabular-nums ml-1.5 font-semibold">{n.toLocaleString()}</span>}
              </button>
            ))}
          </div>
          <p className="text-[12px] text-muted">
            Duplicates are also counted in their match group. Showing {preview.rowsShown.toLocaleString()} of {preview.summary.total.toLocaleString()} rows: every row that needs attention plus a sample of clean ones.
          </p>

          {(preview.summary.ambiguous > 0 || preview.summary.unmatched > 0) && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-alt px-3 py-2 text-[13px]">
              <label htmlFor="bulk-agent" className="font-semibold">
                Give every row without an agent to
              </label>
              <select id="bulk-agent" className="input !w-auto" value={bulkAgent} onChange={(e) => setBulkAgent(e.target.value)}>
                <option value="">Choose an agent</option>
                {preview.agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-ghost"
                disabled={!bulkAgent}
                onClick={() => {
                  setChoices((c) => {
                    const next = { ...c };
                    for (const r of preview.rows) {
                      if (r.phone && !r.repeatOf && r.status !== "matched" && !next[String(r.rowNumber)]) next[String(r.rowNumber)] = bulkAgent;
                    }
                    return next;
                  });
                }}
              >
                Apply
              </button>
            </div>
          )}

          <div className="max-h-[520px] overflow-auto rounded-lg border border-line">
            <table className="w-full min-w-[920px] border-collapse text-[13px]">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className="ivr-th">Row</th>
                  <th className="ivr-th">Member</th>
                  <th className="ivr-th">Category</th>
                  <th className="ivr-th">Agent in file</th>
                  <th className="ivr-th">Allocated to</th>
                  <th className="ivr-th">Allocated by</th>
                  <th className="ivr-th">Result</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => {
                  const key = String(r.rowNumber);
                  const chosen = choices[key];
                  const res = rowResult(r, chosen);
                  const editable = !!r.phone && !r.repeatOf && r.status !== "matched";
                  const suggested = new Set(r.candidates.map((c) => c.userId));
                  return (
                    <tr key={r.rowNumber}>
                      <td className="ivr-td tabular-nums text-muted">{r.rowNumber}</td>
                      <td className="ivr-td">
                        <p className="font-medium">{r.name}</p>
                        <p className="font-mono text-[12px] text-muted">{r.phone ?? (r.rawPhone || "no phone")}</p>
                      </td>
                      <td className="ivr-td max-w-[160px] truncate text-muted">{r.category ?? "–"}</td>
                      <td className="ivr-td max-w-[200px] text-muted">{r.agentText || "–"}</td>
                      <td className="ivr-td">
                        {editable ? (
                          <select
                            aria-label={`Agent for row ${r.rowNumber}`}
                            className="input"
                            value={chosen ?? ""}
                            onChange={(e) => setChoices((c) => ({ ...c, [key]: e.target.value }))}
                          >
                            <option value="">{r.status === "ambiguous" ? "Choose…" : "Leave unassigned"}</option>
                            {r.candidates.length > 0 && (
                              <optgroup label="Suggested">
                                {r.candidates.map((c) => (
                                  <option key={c.userId} value={c.userId}>
                                    {c.name}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            <optgroup label="All agents">
                              {preview.agents
                                .filter((a) => !suggested.has(a.id))
                                .map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.name}
                                  </option>
                                ))}
                            </optgroup>
                          </select>
                        ) : (
                          (r.matchedName ?? r.allocName ?? <span className="text-muted">–</span>)
                        )}
                        {r.note && !chosen && <p className="mt-0.5 text-[11.5px] text-muted">{r.note}</p>}
                      </td>
                      <td className="ivr-td text-muted">
                        {chosen
                          ? "Your choice"
                          : r.allocSource && r.allocSource !== "file"
                            ? SOURCE_LABEL[r.allocSource]
                            : r.method
                              ? METHOD_LABEL[r.method]
                              : "–"}
                      </td>
                      <td className="ivr-td">
                        <Chip color={res.color}>{res.label}</Chip>
                        {r.problem && !r.repeatOf && <p className="mt-0.5 text-[11.5px] text-brand-red">{r.problem}</p>}
                        {r.duplicate && (
                          <p className="mt-0.5 text-[11.5px] text-muted">{r.duplicate.hasOwner ? `Owned by ${r.duplicate.ownerName ?? "an agent"}` : "In the unassigned pool"}</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!visibleRows.length && (
                  <tr>
                    <td colSpan={7} className="ivr-td py-8 text-center text-muted">
                      No rows in this view.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap justify-between gap-2">
            <button className="btn btn-ghost" onClick={() => setStep(2)} disabled={busy !== null}>
              Back to columns
            </button>
            <div className="flex items-center gap-3">
              {needChoice > 0 && <span className="text-[12.5px] text-brand-purple">{needChoice} row{needChoice === 1 ? "" : "s"} still need a choice</span>}
              <button className="btn btn-primary" onClick={() => setStep(4)}>
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 4 && preview && (
        <div className="grid gap-4">
          <div>
            <h2 className="text-lg font-bold">Review and save</h2>
            <p className="text-[13px] text-muted">
              {file?.name} · {preview.summary.total.toLocaleString()} rows · {preview.summary.invalid.toLocaleString()} without a usable phone will be rejected.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <fieldset className="grid gap-2">
              <legend className="mb-1 ivr-label">Rows nobody could be found for</legend>
              {(
                [
                  ["pool", "Add to the unassigned pool", "Assign them later from Members and assignment."],
                  ["skip", "Skip them", "They are not imported."],
                ] as const
              ).map(([v, label, hint]) => (
                <label key={v} className={clsx("flex cursor-pointer items-start gap-2 rounded-[12px] border px-4 py-3 text-[0.85rem] transition-colors duration-200", unmatched === v ? "border-primary bg-primary/10" : "border-line")}>
                  <input type="radio" name="unmatched" className="mt-1 accent-[var(--ivr-accent)]" checked={unmatched === v} onChange={() => setUnmatched(v)} />
                  <span>
                    {label}
                    <small className="block text-muted">{hint}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <fieldset className="grid gap-2">
              <legend className="mb-1 ivr-label">Phone number already in the CRM</legend>
              {(
                [
                  ["update", "Update the existing member", "Fills blank fields. Never overwrites an agent's edits."],
                  ["skip", "Skip duplicates", "Existing members are left exactly as they are."],
                ] as const
              ).map(([v, label, hint]) => (
                <label key={v} className={clsx("flex cursor-pointer items-start gap-2 rounded-[12px] border px-4 py-3 text-[0.85rem] transition-colors duration-200", duplicates === v ? "border-primary bg-primary/10" : "border-line")}>
                  <input type="radio" name="duplicates" className="mt-1 accent-[var(--ivr-accent)]" checked={duplicates === v} onChange={() => setDuplicates(v)} />
                  <span>
                    {label}
                    <small className="block text-muted">{hint}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="grid content-start gap-2">
              <p className="mb-1 ivr-label">Ownership of existing members</p>
              <label className={clsx("flex items-start gap-2 rounded-md border px-3 py-2 text-[13px]", duplicates === "skip" ? "opacity-50" : "cursor-pointer border-line")}>
                <input
                  type="checkbox"
                  className="mt-1 accent-[var(--ivr-accent)]"
                  checked={reassign}
                  disabled={duplicates === "skip"}
                  onChange={(e) => setReassign(e.target.checked)}
                />
                <span>
                  Reassign existing members to the agent in this file
                  <small className="block text-muted">Off: members who already have an owner keep them. Members in the pool are always assigned.</small>
                </span>
              </label>
            </div>
          </div>
          {needChoice > 0 && (
            <p className="text-[13px] text-brand-purple">
              {needChoice} row{needChoice === 1 ? " has" : "s have"} no agent chosen and will follow the first option above.
            </p>
          )}
          <div className="flex flex-wrap justify-between gap-2">
            <button className="btn btn-ghost" onClick={() => setStep(3)} disabled={busy !== null}>
              Back
            </button>
            <button className="btn btn-primary" onClick={() => void save()} disabled={busy !== null}>
              {busy === "commit" ? "Saving members…" : "Save members"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
