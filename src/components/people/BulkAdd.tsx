"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Copy, Download, FileSpreadsheet, Plus, Upload, X } from "lucide-react";
import { LinksDialog } from "@/components/people/PeopleDialogs";
import { useToast } from "@/components/Toast";
import { checkImportAction, commitImportAction, type LinkResult } from "@/actions/people";
import { parseCsv, toCsv } from "@/lib/csv";
import { MAX_FILE_BYTES, TEMPLATE_CSV, rowToCells, tableToRows, type ImportRow } from "@/lib/import-parse";
import type { ImportSummary, RowCheck, RowOutcome, RowStatus } from "@/lib/import";
import { xlsxToTable } from "@/lib/xlsx-read";

const BATCH = 25;
const GRID_PAGE = 50;
const blank = (row: number): ImportRow => ({ row, name: "", email: "", branch: "", team: "", manager: "", role: "", applications: "", designation: "" });
type Filter = "all" | "ready" | RowStatus;
type Phase = "edit" | "running" | "done";

const STATUS_LABEL: Record<RowStatus, string> = { valid: "Ready", needs_correction: "Needs correction", invalid: "Invalid", duplicate: "Duplicate", exists: "Already exists" };
const STATUS_CLASS: Record<RowStatus, string> = { valid: "badge badge-green", needs_correction: "badge badge-purple", invalid: "badge badge-red", duplicate: "badge badge-red", exists: "badge badge-neutral" };

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([`﻿${text}`], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

/** Add many people: upload a CSV or Excel file (or type rows), correct them on screen, see exactly what will happen, then create them. */
export function BulkAdd({ base, domains }: { base: string; domains: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [existing, setExisting] = useState<"skip" | "update">("skip");
  const [invite, setInvite] = useState(true);
  const [checks, setChecks] = useState<Map<number, RowCheck>>(new Map());
  const [order, setOrder] = useState<number[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [stale, setStale] = useState(false);
  const [checking, setChecking] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const [phase, setPhase] = useState<Phase>("edit");
  const [progress, setProgress] = useState(0);
  const [outcomes, setOutcomes] = useState<Map<number, RowOutcome>>(new Map());
  const [links, setLinks] = useState<LinkResult[] | null>(null);
  const seq = useRef(0);

  const runCheck = useCallback(async (list: ImportRow[], policy: "skip" | "update") => {
    if (list.length === 0) { setChecks(new Map()); setOrder([]); setSummary(null); setStale(false); return; }
    const mine = ++seq.current;
    setChecking(true);
    const r = await checkImportAction(list, policy);
    if (mine !== seq.current) return; // a newer check is already on its way
    setChecking(false);
    if (!r.ok) { setProblem(r.error); return; }
    setProblem(null);
    setChecks(new Map(r.data.checks.map((c) => [c.row, c])));
    setOrder(r.data.order);
    setSummary(r.data.summary);
    setStale(false);
  }, []);

  // After a pause in editing, check the rows again.
  useEffect(() => {
    if (phase !== "edit" || !stale) return;
    const t = setTimeout(() => void runCheck(rows, existing), 900);
    return () => clearTimeout(t);
  }, [rows, stale, phase, existing, runCheck]);

  async function pick(file: File | undefined) {
    if (!file) return;
    setProblem(null); setIgnored([]); setFileName(file.name); setPhase("edit"); setOutcomes(new Map()); setPage(1); setFilter("all");
    if (file.size > MAX_FILE_BYTES) return setProblem("That file is over 2 MB. Split it into smaller files.");
    try {
      const isXlsx = /\.xlsx$/i.test(file.name);
      if (!isXlsx && !/\.(csv|txt)$/i.test(file.name)) return setProblem("Choose a .csv or .xlsx file.");
      const table = isXlsx ? xlsxToTable(new Uint8Array(await file.arrayBuffer())) : parseCsv(await file.text());
      const parsed = tableToRows(table);
      if (parsed.problem) { setRows([]); setChecks(new Map()); setSummary(null); return setProblem(parsed.problem); }
      setIgnored(parsed.ignoredColumns);
      setRows(parsed.rows);
      void runCheck(parsed.rows, existing);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That file could not be read.");
    }
  }

  const edit = (row: number, k: keyof ImportRow, v: string) => { setRows((s) => s.map((r) => (r.row === row ? { ...r, [k]: v } : r))); setStale(true); };
  const addRow = () => { setRows((s) => [...s, blank((s.at(-1)?.row ?? 0) + 1)]); setStale(true); setPage(Math.ceil((rows.length + 1) / GRID_PAGE)); setFilter("all"); };
  const removeRow = (row: number) => { setRows((s) => s.filter((r) => r.row !== row)); setStale(true); };

  const ready = (c?: RowCheck) => !!c && (c.action === "create" || c.action === "update");
  const visible = useMemo(() => rows.filter((r) => {
    const c = checks.get(r.row);
    if (filter === "all") return true;
    if (filter === "ready") return ready(c);
    return c?.status === filter;
  }), [rows, checks, filter]);
  const pages = Math.max(1, Math.ceil(visible.length / GRID_PAGE));
  const shown = visible.slice((Math.min(page, pages) - 1) * GRID_PAGE, Math.min(page, pages) * GRID_PAGE);
  const canRun = phase === "edit" && !checking && !stale && !!summary && summary.willCreate + summary.willUpdate > 0;

  async function runImport(only: number[]) {
    setPhase("running"); setProgress(0);
    const next = new Map(outcomes);
    for (let i = 0; i < only.length; i += BATCH) {
      const slice = only.slice(i, i + BATCH);
      const r = await commitImportAction(rows, existing, slice, invite);
      if (r.ok) for (const o of r.data) next.set(o.row, o);
      else for (const n of slice) next.set(n, { row: n, name: checks.get(n)?.name ?? "", email: checks.get(n)?.email ?? "", outcome: "failed", message: r.error, invitation: "none" });
      setOutcomes(new Map(next)); setProgress(Math.min(i + BATCH, only.length));
    }
    setPhase("done");
    const made = [...next.values()].filter((o) => o.outcome === "created").length;
    toast.success(`${made} user${made === 1 ? "" : "s"} created.`);
  }

  async function retryFailed() {
    const failed = [...outcomes.values()].filter((o) => o.outcome === "failed").map((o) => o.row);
    if (failed.length === 0) return;
    setPhase("running");
    const r = await checkImportAction(rows, existing);
    if (!r.ok) { setPhase("done"); return toast.error(r.error); }
    const redo = r.data.order.filter((n) => failed.includes(n));
    // Rows that now exist (they succeeded after all) are reported as skipped by the commit itself.
    await runImport(redo.length ? redo : failed.slice(0, BATCH));
  }

  // Everything that happened to each row, from the check (not sent) and the commit (sent).
  const finalRows = useMemo(() => rows.map((r) => {
    const o = outcomes.get(r.row), c = checks.get(r.row);
    if (o) return { r, outcome: o.outcome as string, message: o.message, invitation: o.invitation as string };
    if (c && (c.status === "invalid" || c.status === "needs_correction" || c.status === "duplicate")) return { r, outcome: "not imported", message: c.errors.join(" "), invitation: "none" };
    if (c && c.status === "exists") return { r, outcome: "skipped", message: "Already has an account. Not changed.", invitation: "none" };
    return { r, outcome: "not run", message: "", invitation: "none" };
  }), [rows, outcomes, checks]);
  const tally = (o: string) => finalRows.filter((x) => x.outcome === o).length;
  const manualLinks = [...outcomes.values()].filter((o) => o.link);
  const counts = (k: Filter) => k === "all" ? rows.length : k === "ready" ? rows.filter((r) => ready(checks.get(r.row))).length : rows.filter((r) => checks.get(r.row)?.status === k).length;

  return (
    <div className="space-y-6">
      <Link href={base} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-primary"><ArrowLeft size={14} /> Back to people</Link>

      <section className="glass !rounded-md space-y-4 p-5 sm:p-6">
        <div>
          <h2 className="text-xl">Bulk add users</h2>
          <p className="mt-1 text-sm text-muted">
            Create many accounts at once from a CSV or Excel file, or type the rows below. Each person receives a one-time link to choose their own password, so <b>no password goes in the file</b>.
            Branch, team and reporting manager are checked before anything is created. {domains && <>Emails must end with {domains}.</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="btn btn-primary btn-sm cursor-pointer"><Upload size={14} /> Choose CSV or Excel file
            <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" disabled={phase === "running"} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} /></label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => download("users-template.csv", TEMPLATE_CSV)}><Download size={14} /> Download template</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={phase === "running"} onClick={() => { setPhase("edit"); setOutcomes(new Map()); addRow(); }}><Plus size={14} /> Add a row by hand</button>
          {fileName && <span className="flex items-center gap-1.5 text-sm text-muted"><FileSpreadsheet size={14} /> {fileName}</span>}
        </div>
        {problem && <div role="alert" className="alert alert-red">{problem}</div>}
        {ignored.length > 0 && <div className="alert">These columns are not used and were ignored: {ignored.join(", ")}.</div>}
      </section>

      {rows.length > 0 && phase !== "done" && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Show rows">
            {(["all", "ready", "needs_correction", "invalid", "duplicate", "exists"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={filter === k} className={`rounded-pill px-3 py-1.5 text-xs font-semibold ${filter === k ? "bg-primary text-white" : "bg-alt text-muted hover:bg-blue-tint"}`}
                onClick={() => { setFilter(k); setPage(1); }}>{k === "all" ? "All" : k === "ready" ? "Ready" : STATUS_LABEL[k]} · {counts(k)}</button>
            ))}
            <span className="ml-auto text-xs text-muted" aria-live="polite">{checking ? "Checking…" : stale ? "Changes not checked yet" : summary ? "Checked" : ""}</span>
          </div>

          <div className="table-wrap">
            <table>
              <thead><tr><th>Row</th><th>Name *</th><th>Email *</th><th>Branch</th><th>Team</th><th>Reporting manager</th><th>Role</th><th>Applications</th><th>Designation</th><th>Check</th><th><span className="sr-only">Remove</span></th></tr></thead>
              <tbody>
                {shown.map((r) => {
                  const c = checks.get(r.row);
                  const cell = (k: keyof ImportRow, w = "min-w-32") => (
                    <td><input className={`input !py-1.5 text-xs ${w}`} value={r[k] as string} aria-label={`${k} for row ${r.row}`} disabled={phase === "running"} onChange={(e) => edit(r.row, k, e.target.value)} /></td>
                  );
                  return (
                    <tr key={r.row} data-row={r.row} className={c && c.errors.length ? "bg-red-tint/40" : ""}>
                      <td className="text-xs text-muted">{r.row}</td>
                      {cell("name")}{cell("email", "min-w-44")}{cell("branch")}{cell("team")}{cell("manager", "min-w-44")}{cell("role", "min-w-24")}{cell("applications", "min-w-44")}{cell("designation")}
                      <td className="min-w-56 text-xs">
                        {c ? (
                          <>
                            <span className={STATUS_CLASS[c.status]}>{STATUS_LABEL[c.status]}</span>
                            {c.action === "create" && <span className="ml-1 text-subtle">will create</span>}
                            {c.action === "update" && <span className="ml-1 text-subtle">will update</span>}
                            {c.errors.map((e, i) => <span key={i} className="mt-1 block text-brand-red">{e}</span>)}
                            {c.warnings.map((e, i) => <span key={i} className="mt-1 block text-muted">{e}</span>)}
                          </>
                        ) : <span className="text-subtle">…</span>}
                      </td>
                      <td><button type="button" className="chip !p-1.5 text-muted" aria-label={`Remove row ${r.row}`} disabled={phase === "running"} onClick={() => removeRow(r.row)}><X size={14} /></button></td>
                    </tr>
                  );
                })}
                {shown.length === 0 && <tr><td colSpan={12} className="text-subtle">No rows to show here.</td></tr>}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <nav className="flex items-center justify-end gap-2 text-sm text-muted" aria-label="Pages of rows">
              <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {Math.min(page, pages)} of {pages}</span>
              <button className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
            </nav>
          )}

          <div className="glass !rounded-md space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block"><span className="label-xs mb-1.5 block">If an email already has an account</span>
                <select className="input" value={existing} disabled={phase === "running"} onChange={(e) => { setExisting(e.target.value as "skip" | "update"); setStale(true); }}>
                  <option value="skip">Skip it (change nothing)</option>
                  <option value="update">Update their branch, team, manager and designation, and add the applications</option>
                </select></label>
              <label className="flex items-start gap-2 text-sm sm:pt-6"><input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--c-primary)]" checked={invite} disabled={phase === "running"} onChange={(e) => setInvite(e.target.checked)} />
                <span>Create a setup link for each new person and email it. If email is not set up, you will get the links to pass on.</span></label>
            </div>
            {summary && (
              <p className="text-sm" aria-live="polite">
                <b>{summary.willCreate}</b> to create{summary.willUpdate ? <>, <b>{summary.willUpdate}</b> to update</> : null}, {summary.invalid + summary.needsCorrection + summary.duplicate} need fixing, {summary.exists} already exist{existing === "skip" ? " (skipped)" : ""}.
                {summary.invalid + summary.needsCorrection + summary.duplicate > 0 && " Rows that need fixing are left out unless you correct them above."}
              </p>
            )}
            {phase === "running" && (
              <div role="status" aria-live="polite"><p className="text-sm">Creating… {progress} of {order.length || progress}</p>
                <div className="mt-1 h-2 overflow-hidden rounded-pill bg-alt"><div className="h-full bg-primary transition-all" style={{ width: `${order.length ? (progress / order.length) * 100 : 0}%` }} /></div></div>
            )}
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-primary btn-sm" disabled={!canRun} onClick={() => void runImport(order)}>Create {summary ? summary.willCreate + summary.willUpdate : 0} {summary && summary.willCreate + summary.willUpdate === 1 ? "account" : "accounts"}</button>
              <button className="btn btn-ghost btn-sm" disabled={checking || phase === "running"} onClick={() => void runCheck(rows, existing)}>Check again</button>
              {summary && summary.invalid + summary.needsCorrection + summary.duplicate > 0 && (
                <button className="btn btn-ghost btn-sm" onClick={() => download("rows-to-fix.csv", toCsv([["row", "problem", "name", "email", "branch", "team", "reporting_manager", "role", "applications", "designation"], ...rows.filter((r) => { const c = checks.get(r.row); return c && c.errors.length; }).map((r) => [String(r.row), checks.get(r.row)!.errors.join(" "), ...rowToCells(r)])]))}><Download size={14} /> Download rows to fix</button>
              )}
            </div>
          </div>
        </section>
      )}

      {phase === "done" && (
        <section className="space-y-4" aria-label="Import results">
          <div role="status" className="alert alert-green"><CheckCircle2 size={18} className="mt-0.5 shrink-0" />
            <span>Finished. {rows.length} submitted: <b>{tally("created")}</b> created, <b>{tally("updated")}</b> updated, <b>{tally("skipped")}</b> skipped, <b>{tally("invalid") + tally("not imported")}</b> not imported (invalid), <b>{tally("failed")}</b> failed. Recorded in the audit log.</span></div>
          <p className="text-sm text-muted">
            Invitations: {[...outcomes.values()].filter((o) => o.invitation === "sent").length} emailed, {[...outcomes.values()].filter((o) => o.invitation === "manual").length} to pass on by hand, {[...outcomes.values()].filter((o) => o.invitation === "failed").length} could not be emailed, {[...outcomes.values()].filter((o) => o.invitation === "not_sent").length} not sent.
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary btn-sm" onClick={() => download("import-report.csv", toCsv([["row", "name", "email", "result", "details", "invitation"], ...finalRows.map((x) => [String(x.r.row), x.r.name, x.r.email, x.outcome, x.message, x.invitation])]))}><Download size={14} /> Download report (CSV)</button>
            {manualLinks.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setLinks(manualLinks.map((o, i) => ({ id: String(i), name: o.name, email: o.email, ok: true, delivery: o.invitation === "failed" ? "failed" : "manual", link: o.link ?? null, message: o.invitation === "failed" ? "The email could not be sent. Pass the link on yourself." : "No email is set up. Pass the link on yourself." })))}><Copy size={14} /> Show {manualLinks.length} setup link{manualLinks.length === 1 ? "" : "s"}</button>}
            {tally("failed") > 0 && <button className="btn btn-ghost btn-sm" onClick={() => void retryFailed()}>Retry the {tally("failed")} failed rows (safe: nobody is created twice)</button>}
            <button className="btn btn-ghost btn-sm" onClick={() => { setRows([]); setChecks(new Map()); setOutcomes(new Map()); setSummary(null); setFileName(""); setPhase("edit"); }}>Start another import</button>
            <Link className="btn btn-ghost btn-sm" href={base}>View people</Link>
          </div>
          <p className="text-xs text-subtle">The report lists results and reasons only. It never contains passwords or setup links.</p>
          <div className="table-wrap max-h-[28rem] overflow-y-auto"><table>
            <thead><tr><th>Row</th><th>Name</th><th>Email</th><th>Result</th><th>Details</th></tr></thead>
            <tbody>{finalRows.map((x) => (
              <tr key={x.r.row}><td>{x.r.row}</td><td>{x.r.name}</td><td>{x.r.email || <span className="text-subtle">(blank)</span>}</td>
                <td><span className={`badge ${x.outcome === "created" || x.outcome === "updated" ? "badge-green" : x.outcome === "skipped" ? "badge-neutral" : "badge-red"}`}>{x.outcome}</span></td>
                <td className="text-xs text-muted">{x.message}</td></tr>
            ))}</tbody>
          </table></div>
        </section>
      )}

      {links && <LinksDialog results={links} onClose={() => setLinks(null)} />}
    </div>
  );
}
