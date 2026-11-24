"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, FileUp, RotateCcw, Undo2 } from "lucide-react";
import { useToast } from "@/components/Toast";
import { api } from "@/components/approvals/api";
import { formatDate, formatDateTime, formatINR } from "@/lib/approvals/format";
import type { BatchRow, CategoryDecision, ImportResult, Preview, RowState } from "@/lib/approvals/historical/import";
import { categoryKey } from "@/lib/approvals/historical/rules";

const STATE_LABEL: Record<RowState, string> = { ready: "Ready", review: "Ready, see notes", duplicate: "Already imported", error: "Cannot import" };
const STATE_TONE: Record<RowState, string> = { ready: "badge-green", review: "badge-amber", duplicate: "badge-neutral", error: "badge-red" };
const CREATE = "__create__";

function Count({ label, value, tone, testId }: { label: string; value: number; tone?: string; testId: string }) {
  return (
    <div className="rounded-[12px] border border-line bg-white px-4 py-3" data-testid={testId}>
      <p className="text-xs font-semibold uppercase tracking-wide text-subtle">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone ?? "text-ink"}`}>{value}</p>
    </div>
  );
}

/**
 * Approval System → Setup & Configuration → Historical Import. Choose a file, see what an import would do (nothing is saved), decide the
 * categories the hub does not know, then import. Below: every earlier import, with its report and Undo.
 */
export function HistoricalImport({ batches }: { batches: BatchRow[] }) {
  const toast = useToast();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [show, setShow] = useState<RowState | "all" | "attention">("attention");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const reset = () => { setFile(null); setPreview(null); setResult(null); setError(null); setDecisions({}); if (input.current) input.current.value = ""; };

  const choose = (f: File | undefined) => {
    if (!f) return;
    setResult(null); setPreview(null); setError(null); setDecisions({});
    if (f.size > 4 * 1024 * 1024) { setError("The file is larger than 4 MB. Split it into smaller files."); return; }
    start(async () => {
      const text = await f.text();
      setFile({ name: f.name, text });
      const r = await api<{ preview: Preview }>("POST", "/api/approvals/historical/preview", { fileName: f.name, text });
      if (r.ok) setPreview(r.data.preview); else setError(r.error);
    });
  };

  const unmatched = useMemo(() => preview?.categories.filter((c) => !c.match) ?? [], [preview]);
  const undecided = unmatched.filter((c) => !decisions[categoryKey(c.source)]);
  const importable = preview ? preview.ready + preview.review : 0;

  const doImport = () => {
    if (!file || !preview) return;
    const body: Record<string, CategoryDecision> = {};
    for (const [k, v] of Object.entries(decisions)) if (v) body[k] = v === CREATE ? { create: true } : { categoryId: v };
    start(async () => {
      const r = await api<{ result: ImportResult }>("POST", "/api/approvals/historical/import", { fileName: file.name, text: file.text, decisions: body });
      if (!r.ok) { toast.error(r.error); return; }
      setResult(r.data.result); setPreview(null);
      toast.success(`${r.data.result.imported} imported`);
      router.refresh();
    });
  };

  const undo = (b: BatchRow) => {
    if (!confirm(`Remove the ${b.tickets} tickets imported from ${b.fileName}? The import stays in this list, marked undone.`)) return;
    start(async () => {
      const r = await api<{ removed: number }>("POST", `/api/approvals/historical/batches/${b.id}/undo`, {});
      if (r.ok) { toast.success(`${r.data.removed} tickets removed`); router.refresh(); } else toast.error(r.error);
    });
  };

  const rows = preview?.rows.filter((r) => show === "all" || (show === "attention" ? r.state !== "ready" : r.state === show)) ?? [];

  return (
    <div className="space-y-8">
      <section aria-labelledby="hist-upload" className="space-y-3">
        <h2 id="hist-upload" className="text-lg">1. Choose the file</h2>
        <p className="max-w-3xl text-sm text-subtle">
          A JSON export from the old system. Supported today: Zoho Creator&apos;s <b>All Expenditures</b> and <b>All Hr</b> exports, recognised by their contents. Nothing is saved until you press
          Import: first you see what would happen to every record. Imported records are archived tickets: they are never routed to an approver,
          nobody is notified, and nobody can approve, reject or change them.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input ref={input} type="file" accept=".json,application/json" className="sr-only" id="hist-file" data-testid="hist-file" onChange={(e) => choose(e.target.files?.[0])} />
          <label htmlFor="hist-file" className="btn btn-primary btn-sm cursor-pointer"><FileUp size={15} aria-hidden /> {file ? "Choose another file" : "Choose file"}</label>
          {file && <span className="text-sm text-ink">{file.name}</span>}
          {pending && <span className="text-sm text-subtle" role="status">Working…</span>}
          {(file || result) && <button type="button" className="btn btn-ghost btn-sm" onClick={reset}><RotateCcw size={14} aria-hidden /> Start again</button>}
        </div>
        {error && <p role="alert" className="apr-notice apr-notice-red max-w-3xl"><AlertCircle size={16} className="mr-1 inline" aria-hidden />{error}</p>}
      </section>

      {preview && (
        <section aria-labelledby="hist-preview" className="space-y-5" data-testid="hist-preview">
          <h2 id="hist-preview" className="text-lg">2. Check what would happen</h2>
          <p className="text-sm text-subtle" data-testid="hist-source">
            {preview.sourceLabel} · {preview.fileName} · They become <b>{preview.form === "hr" ? "HR requests" : "Expenditure requests"}</b>
            {preview.form === "hr" ? ", shown only to those who may see HR requests." : "."}
          </p>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Count label="Records in the file" value={preview.total} testId="hist-total" />
            <Count label="Ready to import" value={preview.ready + preview.review} tone="text-[var(--z-green)]" testId="hist-ready" />
            <Count label="Of those, with notes" value={preview.review} tone="text-[#b7791f]" testId="hist-review" />
            <Count label="Already imported" value={preview.duplicates} testId="hist-duplicates" />
            <Count label="Cannot import" value={preview.errors} tone={preview.errors ? "text-[var(--z-red)]" : undefined} testId="hist-errors" />
            <Count label="Requesters not linked" value={preview.unmatchedRequesters.reduce((n, u) => n + u.count, 0)} testId="hist-unlinked" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Count label="No date of request" value={preview.missingDates} testId="hist-missing-dates" />
            <Count label="No amount" value={preview.missingAmounts} testId="hist-missing-amounts" />
            <Count label="No requester email" value={preview.missingEmails} testId="hist-missing-emails" />
            <Count label="Files named (names only)" value={preview.attachmentRefs} testId="hist-attachments" />
          </div>
          {(preview.missingDates > 0 || preview.attachmentRefs > 0) && (
            <p className="max-w-3xl text-xs text-subtle">
              Nothing missing is filled in. A record with no date of request keeps none: it gets no financial year, is numbered in the
              undated series ({preview.form === "hr" ? "HR" : "EXP"}-UNDATED-0001, …) and is listed by the earliest time it does record, shown as
              such. A file the source names is kept by name; a recovered copy can be attached to the ticket later.
            </p>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-bold">Status in {preview.systemLabel}</h3>
              <ul className="space-y-1 text-sm" data-testid="hist-statuses">
                {preview.statuses.map((s) => <li key={s.status} className="flex justify-between gap-3 border-b border-line py-1"><span>{s.status}</span><b>{s.count}</b></li>)}
              </ul>
              <p className="mt-2 text-xs text-subtle">Kept exactly as they are. Every record becomes a Historical ticket: Recommend and Pending ones are not sent to anyone.</p>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-bold">Requesters not linked to a hub user</h3>
              {preview.unmatchedRequesters.length === 0 ? <p className="text-sm text-subtle">Every requester matches a hub user by email and name.</p> : (
                <ul className="space-y-2 text-sm" data-testid="hist-unmatched">
                  {preview.unmatchedRequesters.map((u) => (
                    <li key={`${u.email}|${u.name}`} className="border-b border-line pb-2">
                      <b>{u.name}</b> {u.email ? `· ${u.email}` : "· no email"} · {u.count} {u.count === 1 ? "record" : "records"}
                      <span className="block text-xs text-subtle">{u.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-subtle">They are imported under the name and email the old system recorded, linked to nobody. Nobody is attributed by guess.</p>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-bold">Categories</h3>
            <div className="table-wrap">
              <table data-testid="hist-categories">
                <thead><tr><th>In {preview.systemLabel}</th><th>Records</th><th>Category ID there</th><th>In the hub</th></tr></thead>
                <tbody>
                  {preview.categories.map((c) => {
                    const key = categoryKey(c.source);
                    return (
                      <tr key={key}>
                        <td className="font-semibold">{c.source}</td>
                        <td>{c.count}</td>
                        <td className="font-mono text-xs">{c.sourceIds.join(", ") || "—"}</td>
                        <td>
                          {c.match ? (
                            <span>{c.match.name}{c.match.active ? "" : " (inactive)"} <span className="badge badge-green ml-1">Matched</span></span>
                          ) : (
                            <select aria-label={`Hub category for ${c.source}`} className="input min-w-64" value={decisions[key] ?? ""} onChange={(e) => setDecisions({ ...decisions, [key]: e.target.value })} data-testid="hist-category-choice">
                              <option value="">Choose…</option>
                              <option value={CREATE}>Add &quot;{c.source}&quot; as a historical {preview.form === "hr" ? "HR request type" : "category"} (not offered on forms)</option>
                              <optgroup label={preview.form === "hr" ? "File under an existing HR request type" : "File under an existing category"}>
                                {preview.hubCategories.map((h) => <option key={h.id} value={h.id}>{h.name}{h.active ? "" : " (inactive)"}</option>)}
                              </optgroup>
                            </select>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-subtle">
              {preview.form === "hr"
                ? "Only an exact name matches by itself: file a category under an existing HR request type only when it is the same thing. "
                : "Filing under an existing category saves the old name as that category's old spelling, so the next import matches it by itself. "}
              A historical {preview.form === "hr" ? "HR request type" : "category"} is added inactive: the live forms never offer it. The original
              category stays on every ticket.
            </p>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-bold">Records</h3>
              <select aria-label="Show records" className="input w-56" value={show} onChange={(e) => setShow(e.target.value as typeof show)} data-testid="hist-show">
                <option value="attention">Needing attention</option>
                <option value="all">All</option>
                <option value="ready">Ready</option>
                <option value="review">Ready, with notes</option>
                <option value="duplicate">Already imported</option>
                <option value="error">Cannot import</option>
              </select>
              <span className="text-xs text-subtle">{rows.length} shown</span>
            </div>
            <div className="table-wrap max-h-[28rem] overflow-y-auto">
              <table data-testid="hist-rows">
                <thead><tr><th>#</th><th>ID there</th><th>Date of request</th><th>Requester</th><th>Category</th><th>Amount</th><th>Status there</th><th>Import</th><th>Notes</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.index}>
                      <td>{r.index}</td>
                      <td className="font-mono text-xs">{r.legacyId || "—"}</td>
                      <td className="whitespace-nowrap">{r.requestedAt ? formatDateTime(r.requestedAt) : <span className="text-subtle">Not recorded</span>}</td>
                      <td>{r.requesterName || "—"}{r.linkedName ? <span className="block text-xs text-subtle">Linked to {r.linkedName}</span> : null}</td>
                      <td>{r.categoryName || "—"}</td>
                      <td className="whitespace-nowrap text-right">{r.amountPaise == null ? "—" : formatINR(r.amountPaise, { symbol: true })}</td>
                      <td>{r.sourceStatus || "—"}</td>
                      <td><span className={`badge whitespace-nowrap ${STATE_TONE[r.state]}`}>{STATE_LABEL[r.state]}</span></td>
                      <td className="min-w-72 text-xs">{r.messages.map((m, i) => <span key={i} className="block">{m}</span>)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={9} className="text-center text-subtle">Nothing to show.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <button type="button" className="btn btn-primary" disabled={pending || importable === 0 || undecided.length > 0} onClick={doImport} data-testid="hist-import">
              Import {importable} {importable === 1 ? "record" : "records"}
            </button>
            {undecided.length > 0 && <span className="text-sm text-[var(--z-red)]">Choose what to do with {undecided.length} {undecided.length === 1 ? "category" : "categories"} first.</span>}
            {importable === 0 && <span className="text-sm text-subtle">Nothing here can be imported.</span>}
          </div>
        </section>
      )}

      {result && <Report result={result} />}

      <section aria-labelledby="hist-history" className="space-y-3">
        <h2 id="hist-history" className="text-lg">Earlier imports</h2>
        {batches.length === 0 ? <p className="text-sm text-subtle">No historical imports yet.</p> : (
          <div className="table-wrap">
            <table data-testid="hist-batches">
              <thead><tr><th>When</th><th>File</th><th>From</th><th>By</th><th>Records</th><th>Imported</th><th>Skipped</th><th>Failed</th><th></th></tr></thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td className="whitespace-nowrap">{formatDateTime(b.createdAt)}</td>
                    <td>{b.fileName}</td>
                    <td>{b.systemLabel}</td>
                    <td>{b.importedByName}</td>
                    <td>{b.recordCount}</td>
                    <td>{b.imported}</td>
                    <td>{b.skipped}</td>
                    <td>{b.failed}</td>
                    <td className="whitespace-nowrap">
                      {b.undoneAt ? <span className="text-xs text-subtle">Undone {formatDate(b.undoneAt)}{b.undoneByName ? ` by ${b.undoneByName}` : ""}</span> : (
                        <span className="flex gap-2">
                          <Link className="btn btn-ghost btn-sm" href="/approvals/expenditures/all?status=historical">View tickets</Link>
                          <button type="button" className="btn btn-ghost btn-sm" disabled={pending || b.tickets === 0} onClick={() => undo(b)} data-testid="hist-undo"><Undo2 size={14} aria-hidden /> Undo</button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** What the import did with every record: the reconciliation. */
function Report({ result }: { result: ImportResult }) {
  const notImported = result.rows.filter((r) => r.outcome !== "imported");
  return (
    <section aria-labelledby="hist-result" className="space-y-3" data-testid="hist-result">
      <h2 id="hist-result" className="text-lg"><CheckCircle2 size={18} className="mr-1 inline text-[var(--z-green)]" aria-hidden />Import finished</h2>
      <p className="text-sm" data-testid="hist-reconcile">
        <b>{result.total}</b> records in the file: <b>{result.imported}</b> imported, <b>{result.skipped}</b> skipped, <b>{result.failed}</b> failed.
        {result.imported + result.skipped + result.failed === result.total ? " Every record is accounted for." : ""}
      </p>
      <p className="text-sm"><Link className="apr-link" href="/approvals/expenditures/all?status=historical">See the imported tickets</Link> (All Expenditures, status Historical).</p>
      {notImported.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>ID there</th><th>Outcome</th><th>Why</th></tr></thead>
            <tbody>{notImported.map((r) => <tr key={r.index}><td>{r.index}</td><td className="font-mono text-xs">{r.legacyId || "—"}</td><td>{r.outcome}</td><td className="text-xs">{r.message}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
