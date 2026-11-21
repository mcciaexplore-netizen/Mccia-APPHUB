import Image from "next/image";
import Link from "next/link";
import { Download, Paperclip } from "lucide-react";
import { StatusPill } from "@/components/approvals/shared-ui";
import { BudgetId } from "@/components/approvals/BudgetId";
import { DecisionPanel, WithdrawButton } from "@/components/approvals/DecisionPanel";
import { DeleteBudgetButton } from "@/components/approvals/DeleteBudgetButton";
import { PrintButton, PrintedOn } from "@/components/approvals/PrintRequest";
import { Timeline } from "@/components/approvals/Timeline";
import { RevisionChanges } from "@/components/approvals/RevisionChanges";
import { TYPE_LABEL } from "@/lib/approvals/calc";
import { BALANCE_LABEL, versionLabel, type BudgetLine } from "@/lib/approvals/budget";
import { formatDate, formatDateTime, formatINR, isoToDisplay } from "@/lib/approvals/format";
import type { AttachmentRow, BudgetFigures, BudgetRequestView, RequestDetail, StepRow } from "@/lib/approvals/request-queries";

const SLOT_LABEL: Record<string, string> = {
  file_upload: "File upload", file_upload_2: "File upload (second)", tax_invoice: "Tax Invoice", quotation: "Quotation", supporting: "Tax Invoice/Supporting Documents",
};
const STEP_TONE: Record<StepRow["status"], string> = { waiting: "badge-neutral", pending: "badge-amber", approved: "badge-green", rejected: "badge-red", skipped: "badge-neutral", returned: "badge-amber" };
const STEP_LABEL: Record<StepRow["status"], string> = { waiting: "Waiting", pending: "Waiting for decision", approved: "Approved", rejected: "Rejected", skipped: "Not needed", returned: "Returned for corrections" };

const size = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const money = (p: number | null) => (p == null ? "—" : formatINR(p, { symbol: true }));

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (<><dt>{label}</dt><dd>{children || "—"}</dd></>);
}

function Files({ items }: { items: AttachmentRow[] }) {
  if (items.length === 0) return <p className="text-[var(--z-muted)]">No files were attached.</p>;
  return (
    <ul className="divide-y divide-[var(--z-line)] rounded-sm border border-[var(--z-line)]">
      {items.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
          <Paperclip size={15} className="shrink-0 text-[#777]" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-bold" title={a.fileName}>{a.fileName}</span>
            <span className="block text-xs text-[var(--z-muted)]">{SLOT_LABEL[a.slot] ?? a.slot} · {size(a.size)}</span>
          </span>
          <a className="btn btn-ghost btn-sm apr-no-print" href={`/api/approvals/files/${a.id}`} target="_blank" rel="noopener noreferrer">Open</a>
          <a className="btn btn-ghost btn-sm apr-no-print" href={`/api/approvals/files/${a.id}?download=1`} aria-label={`Download ${a.fileName}`}><Download size={14} /></a>
        </li>
      ))}
    </ul>
  );
}

/**
 * One line of the printed approval chain: "Recommended by: Satavisha Natu (HR Admin) — 02-Nov-2026". The last step approves, the ones before
 * it recommend; a step not yet decided says it is waiting. Steps that were not needed are left out.
 */
function chainLine(s: StepRow, last: boolean): string | null {
  const role = `${s.approverName} (${s.stepLabel})`;
  const action = last ? "Approved by" : "Recommended by";
  switch (s.status) {
    case "approved": return `${action}: ${role} — ${formatDate(s.decidedAt)}`;
    case "rejected": return `Rejected by: ${role} — ${formatDate(s.decidedAt)}`;
    case "returned": return `Returned for corrections by: ${role} — ${formatDate(s.decidedAt)}`;
    case "pending": return `${action}: ${role} — Waiting for decision`;
    case "waiting": return `${action}: ${role} — Pending`;
    default: return null;
  }
}

const VERSION_TONE: Record<string, string> = { pending: "badge-amber", approved: "badge-green", rejected: "badge-red", withdrawn: "badge-neutral", returned: "badge-amber" };
const VERSION_STATUS: Record<string, string> = { pending: "Pending", approved: "Approved", rejected: "Rejected", withdrawn: "Withdrawn", returned: "Returned" };

const BALANCE_TONE = { surplus: "text-green-700", deficit: "text-red-700", balanced: "text-[var(--z-muted)]" } as const;

const LINES_TOTAL = { income: "Total Income", expense: "Total Expense", vendor: "Total Vendor Amount" } as const;

/** Income, expense or vendor rows as a small table, with their total under them. */
function LinesTable({ kind, lines, total }: { kind: keyof typeof LINES_TOTAL; lines: BudgetLine[]; total: number }) {
  if (lines.length === 0) return <span className="text-[var(--z-muted)]">None</span>;
  return (
    <table className="apr-budget-lines w-full max-w-xl" data-testid={`budget-${kind}-lines`}>
      <tbody>
        {lines.map((l, i) => <tr key={i}><td className="py-0.5 pr-4">{l.name}</td><td className="py-0.5 text-right">{money(l.amountPaise)}</td></tr>)}
        <tr className="border-t border-[var(--z-line)] font-bold"><td className="pt-1 pr-4">{LINES_TOTAL[kind]}</td><td className="pt-1 text-right">{money(total)}</td></tr>
      </tbody>
    </table>
  );
}

/** A budget's event, income and expenses, summary and amount, shown in the Request section's list (and the vendors of a budget raised when the form still had them). */
function BudgetItems({ b, amountPaise, requestNo, status }: { b: BudgetRequestView; amountPaise: number | null; requestNo: string | null; status: RequestDetail["status"] }) {
  const d = b.details;
  return (
    <>
      <Item label="Budget ID"><BudgetId requestNo={requestNo} status={status} testId="budget-id-row" /></Item>
      <Item label="Event name">{d.eventName}</Item>
      <Item label="Description"><span className="whitespace-pre-wrap">{d.description}</span></Item>
      <Item label="Department">{d.departmentName}</Item>
      <Item label="Financial year">{d.financialYear}</Item>
      <Item label="Income"><LinesTable kind="income" lines={b.incomeLines} total={b.totalIncomePaise} /></Item>
      <Item label="Expenses"><LinesTable kind="expense" lines={b.expenseLines} total={b.totalExpensePaise} /></Item>
      {b.vendorLines.length > 0 && <Item label="Vendors"><LinesTable kind="vendor" lines={b.vendorLines} total={b.totalVendorPaise} /></Item>}
      <Item label="Budget summary">
        <span data-testid="budget-summary-line">
          Total Income {money(b.totalIncomePaise)} · Total Expense {money(b.totalExpensePaise)} ·{" "}{b.vendorLines.length > 0 && <>Total Vendor Amount {money(b.totalVendorPaise)} ·{" "}</>}
          <b className={BALANCE_TONE[b.balance.kind]} data-kind={b.balance.kind}>{BALANCE_LABEL[b.balance.kind]}: {money(b.balance.amountPaise)}</b>
        </span>
      </Item>
      <Item label={b.revisionNo ? "Revised total budget requested" : "Total Budget Requested"}><b>{money(amountPaise)}</b></Item>
      {d.revisionReason && <Item label="Reason for revision"><span className="whitespace-pre-wrap">{d.revisionReason}</span></Item>}
    </>
  );
}

/** What a version's status says in the history: the original "Under Review" while it waits, a revision "Pending". */
const versionStatus = (status: string, revisionNo: number | null) => (status === "pending" ? (revisionNo ? "Pending" : "Under Review") : VERSION_STATUS[status] ?? status);

/** One version's figures as it was sent: the event, income, expenses, vendors and summary. */
function VersionDetails({ f, amountPaise }: { f: BudgetFigures; amountPaise: number | null }) {
  const d = f.details;
  return (
    <dl className="apr-version-details mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[12rem_1fr]">
      <dt className="label-xs">Event name</dt><dd>{d.eventName}</dd>
      <dt className="label-xs">Description</dt><dd className="whitespace-pre-wrap">{d.description}</dd>
      <dt className="label-xs">Department</dt><dd>{d.departmentName}</dd>
      <dt className="label-xs">Financial year</dt><dd>{d.financialYear}</dd>
      <dt className="label-xs">Income</dt><dd><LinesTable kind="income" lines={f.incomeLines} total={f.totalIncomePaise} /></dd>
      <dt className="label-xs">Expenses</dt><dd><LinesTable kind="expense" lines={f.expenseLines} total={f.totalExpensePaise} /></dd>
      {f.vendorLines.length > 0 && <><dt className="label-xs">Vendors</dt><dd><LinesTable kind="vendor" lines={f.vendorLines} total={f.totalVendorPaise} /></dd></>}
      <dt className="label-xs">Budget summary</dt>
      <dd><b className={BALANCE_TONE[f.balance.kind]}>{BALANCE_LABEL[f.balance.kind]}: {money(f.balance.amountPaise)}</b></dd>
      <dt className="label-xs">Total Budget Requested</dt><dd><b>{money(amountPaise)}</b></dd>
    </dl>
  );
}

/**
 * The budget's history: the original and every revision, oldest first, each kept as it was sent, with its own status and the version in
 * force marked. "View details" opens a version's figures right here, so the original and its revisions can be read on one page.
 */
function BudgetHistory({ b, currentId }: { b: BudgetRequestView; currentId: string }) {
  const revisions = b.history.filter((h) => h.revisionNo).length;
  return (
    <section aria-labelledby="budget-history" className={revisions ? "" : "apr-no-print"} data-testid="budget-history">
      <h2 id="budget-history" className="mb-3 flex flex-wrap items-center gap-2">
        Budget History
        <span className="badge badge-neutral" data-testid="budget-revision-count">{revisions} {revisions === 1 ? "revision" : "revisions"}</span>
      </h2>
      <ol className="apr-versions max-w-4xl divide-y divide-[var(--z-line)] rounded border border-[var(--z-line)]">
        {b.history.map((h) => {
          const active = h.id === b.activeId;
          const title = h.revisionNo ? `Revision ${h.revisionNo}` : "Original Budget";
          return (
            <li key={h.id} className={`p-4 ${active ? "apr-budget-active" : ""}`} aria-current={h.id === currentId ? "true" : undefined} data-testid={`budget-version-${h.revisionNo ?? 0}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-bold">
                  {h.canOpen && h.id !== currentId ? <Link href={`/approvals/requests/${h.id}?app=hr`} className="apr-link">{title}</Link> : title}
                  {h.id === currentId && <span className="ml-2 text-sm font-normal text-[var(--z-muted)]">(this page)</span>}
                  {active && <span className="badge badge-green ml-2" data-testid="budget-active-badge">Active budget</span>}
                </p>
                <span className="text-sm text-[var(--z-muted)]">{formatDate(h.submittedAt)}</span>
              </div>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
                <span>Amount: <b data-testid="budget-version-amount">{money(h.amountPaise)}</b></span>
                <span>Status: <span className={`badge ${VERSION_TONE[h.status] ?? "badge-neutral"}`} data-testid="budget-version-status">{versionStatus(h.status, h.revisionNo)}</span></span>
              </div>
              <p className="mt-1 text-sm">
                Budget ID: <BudgetId requestNo={h.requestNo} status={h.status} />
                {h.approverName && <> · Approver: {h.approverName}</>}
                {h.decidedAt && h.status !== "pending" && <> · Decided {formatDate(h.decidedAt)}</>}
              </p>
              {h.reason && <p className="mt-1 text-sm">Reason: <span className="whitespace-pre-wrap" data-testid="budget-version-reason">&ldquo;{h.reason}&rdquo;</span></p>}
              <details className="mt-2" data-testid="budget-version-details">
                <summary className="apr-link cursor-pointer text-sm font-semibold">View details</summary>
                <VersionDetails f={h.figures} amountPaise={h.amountPaise} />
              </details>
            </li>
          );
        })}
      </ol>
      {!b.activeId && <p className="mt-2 text-sm text-[var(--z-muted)]">No version is approved yet, so no budget is in force.</p>}
    </section>
  );
}

/** What the printed page says about the status: decided on a day, or the last thing that happened to it. */
function statusDate(d: RequestDetail): string {
  if (d.decidedAt) return `on ${formatDateTime(d.decidedAt)}`;
  return `since ${formatDateTime(d.events.at(-1)?.createdAt ?? d.requestedAt)}`;
}

/**
 * Everything about one request, read only, with the approver's controls when it is waiting for them. Print (window.print) puts it on paper:
 * the print-only heading, approval chain and footer below appear there, and the controls (.apr-no-print) and the page around it are left out (approvals.css).
 */
export function RequestDetailView({ d, submitter, viewerName }: { d: RequestDetail; submitter: { name: string; department: string | null }; viewerName: string }) {
  const e = d.expenditure;
  const b = d.budget;
  const name = d.hr ? `${d.hr.firstName} ${d.hr.lastName}` : d.requesterName;
  const status = <StatusPill status={d.status} currentStepNo={d.steps.find((s) => s.status === "pending")?.stepNo} />;

  // With at least one revision, a budget's page has a second column: what changed between its versions (not printed).
  const compare = b && b.history.length > 1 ? b.history.map((h) => ({
    id: h.id, label: h.revisionNo ? `Revision ${h.revisionNo}` : "Original", status: h.status, reason: h.reason, amountPaise: h.amountPaise,
    incomeLines: h.figures.incomeLines, expenseLines: h.figures.expenseLines, vendorLines: h.figures.vendorLines,
  })) : null;
  const page = (
    <div className="apr-printable min-w-0 space-y-8">
      <div className="apr-print-only apr-print-head">
        <Image src="/mccia-logo.png" alt="MCCIA" width={134} height={36} loading="eager" className="h-10 w-auto" />
        <h1>{b ? "Budget" : (d.requestNo ?? "Request")} · {b?.revisionNo ? `Budget revision (${versionLabel(b.revisionNo)})` : TYPE_LABEL[d.type]}{(d.hr?.categoryName ?? e?.categoryName ?? b?.details.eventName) ? ` — ${d.hr?.categoryName ?? e?.categoryName ?? b?.details.eventName}` : ""}</h1>
        <dl className="zdl">
          <Item label="Submitted by">{submitter.name}</Item>
          <Item label="Department">{submitter.department}</Item>
          <Item label="Submitted on">{formatDateTime(d.requestedAt)}</Item>
          <Item label="Status"><>{status} {statusDate(d)}</></Item>
        </dl>
      </div>

      <div className="apr-no-print flex flex-wrap items-center gap-3">
        {b ? (
          <h2 className="!text-xl"><span className="mr-2 align-middle text-xs font-semibold uppercase tracking-wide text-[var(--z-muted)]">Budget ID</span><BudgetId requestNo={d.requestNo} status={d.status} testId="budget-id" /></h2>
        ) : <h2 className="!text-xl">{d.requestNo ?? "Request"}</h2>}
        <span className="text-[var(--z-muted)]">{b?.revisionNo ? `Budget revision · ${versionLabel(b.revisionNo)}` : TYPE_LABEL[d.type]}</span>
        {status}
        {b && b.history.length > 1 && <span className="badge badge-neutral">{b.history.length - 1} {b.history.length === 2 ? "revision" : "revisions"}</span>}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {b?.canRevise && <Link href={`/approvals/requests/${d.id}/revise`} className="btn btn-primary btn-sm" data-testid="budget-revise">Revise Budget</Link>}
          <PrintButton />
          {b?.canDelete && <DeleteBudgetButton requestId={d.id} budgetId={b.budgetId} eventName={b.history[0]?.figures.details.eventName ?? b.details.eventName} confirmText={b.deleteConfirm} />}
          {d.can.withdraw && <WithdrawButton id={d.id} />}
        </span>
      </div>
      {b?.canRevise && b.waitingRevisionNo && (
        <p className="apr-no-print -mt-4 text-sm text-[var(--z-muted)]" data-testid="budget-revise-replaces">Rev {b.waitingRevisionNo} is waiting for approval: a new revision replaces it.</p>
      )}
      {b?.reviseBlocked && (
        <p className="apr-no-print -mt-4 text-sm text-[var(--z-muted)]" data-testid="budget-revise-blocked">{b.reviseBlocked}</p>
      )}

      {d.status === "returned" && (
        <div role="status" className="apr-notice max-w-3xl space-y-2">
          <p><b>Returned for corrections{d.returned ? ` by ${d.returned.byName}` : ""}.</b></p>
          {d.returned?.comment && <p className="whitespace-pre-wrap">&ldquo;{d.returned.comment}&rdquo;</p>}
          {d.can.edit ? (
            <p className="apr-no-print"><Link href={`/approvals/requests/${d.id}/edit`} className="btn btn-primary btn-sm">Edit and resubmit</Link></p>
          ) : (
            <p>Waiting for {d.requesterName} to correct it. It goes back to {d.returned?.byName ?? "the same approver"} when they do.</p>
          )}
        </div>
      )}

      {d.can.decide && <div className="apr-no-print"><DecisionPanel id={d.id} mode={d.can.mode} canReturn={!b} /></div>}
      {d.watching && (
        <p className="apr-notice apr-no-print max-w-3xl" role="note" data-testid="watching-note">
          <b>You have view-only access to this request.</b> You can read, print and export it; you cannot approve, reject or change it.
        </p>
      )}

      <section aria-labelledby="req-details">
        <h2 id="req-details" className="mb-3">Request</h2>
        <dl className="zdl">
          <Item label="Name">{name}</Item>
          <Item label="Email">{d.requesterEmail}</Item>
          {!b && <Item label="Category">{d.hr?.categoryName ?? e?.categoryName}</Item>}
          {e?.branchName && <Item label="Branch Name">{e.branchName}</Item>}
          {e && <Item label="Nature of Expenditure"><span className="whitespace-pre-wrap">{e.nature}</span></Item>}
          <Item label="Date of Request">{formatDateTime(d.requestedAt)}</Item>
          {b ? <BudgetItems b={b} amountPaise={d.amountPaise} requestNo={d.requestNo} status={d.status} /> : <>
            <Item label="Financial year">{d.financialYear}</Item>
            <Item label="Amount">{money(d.amountPaise)}</Item>
          </>}
          {d.hr && <Item label="Description"><span className="whitespace-pre-wrap">{d.hr.description}</span></Item>}
          {e && <Item label="Vendor Name"><span className="whitespace-pre-wrap">{e.vendorName}</span></Item>}
          {e && (d.type === "expenditure_small" || e.expenseDate) && <Item label="Date of expense">{isoToDisplay(e.expenseDate)}</Item>}
          {e?.publicationType && <Item label="Type of Publication">{e.publicationType}</Item>}
          {e?.publication && <Item label="Publication">{e.publication}</Item>}
          {e && (d.type === "expenditure_small" || e.taxInvoiceDate) && <Item label="Date of Tax Invoice">{isoToDisplay(e.taxInvoiceDate)}</Item>}
          {d.custom.map((c) => <Item key={c.label} label={c.label}><span className="whitespace-pre-wrap">{c.value}</span></Item>)}
        </dl>
      </section>


      {b && <BudgetHistory b={b} currentId={d.id} />}

      {!b && (
        <section aria-labelledby="req-files">
          <h2 id="req-files" className="mb-3">Attachments</h2>
          <div className="max-w-2xl"><Files items={d.attachments} /></div>
        </section>
      )}

      <section className="apr-print-only apr-print-chain">
        <h2>Approval</h2>
        <ul>{d.steps.map((s) => { const line = chainLine(s, s.stepNo === d.steps.length); return line && <li key={s.stepNo}>{line}</li>; })}</ul>
      </section>

      <section aria-labelledby="req-steps" className="apr-no-print">
        <h2 id="req-steps" className="mb-3">Approval</h2>
        <ul className="max-w-2xl space-y-2">
          {d.steps.map((s) => (
            <li key={s.stepNo} className="flex flex-wrap items-start gap-3 rounded-sm border border-[var(--z-line)] px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block font-bold">{s.approverName}</span>
                <span className="block text-xs text-[var(--z-muted)]">{s.stepLabel}{s.decidedAt ? ` · ${formatDateTime(s.decidedAt)}` : ""}</span>
                {s.comment && <span className="mt-1 block whitespace-pre-wrap text-sm">&ldquo;{s.comment}&rdquo;</span>}
              </span>
              <span className={`badge ${STEP_TONE[s.status]}`}>{s.status === "approved" && s.stepNo < d.steps.length ? "Recommended to DG" : STEP_LABEL[s.status]}</span>
            </li>
          ))}
        </ul>
        {d.decidedAt && (
          <p className="mt-3 text-sm text-[var(--z-muted)]">
            {d.status === "withdrawn" ? "Withdrawn" : d.status === "approved" ? "Approved" : "Rejected"} on {formatDate(d.decidedAt)}.
          </p>
        )}
      </section>

      <section aria-labelledby="req-timeline" className="apr-no-print">
        <h2 id="req-timeline" className="mb-3">Timeline</h2>
        <Timeline events={d.events} />
      </section>

      <footer className="apr-print-only apr-print-foot"><PrintedOn by={viewerName} /></footer>
    </div>
  );
  if (!compare) return page;
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]" data-testid="budget-two-columns">
      {page}
      <div className="xl:sticky xl:top-4"><RevisionChanges versions={compare} currentId={d.id} /></div>
    </div>
  );
}
