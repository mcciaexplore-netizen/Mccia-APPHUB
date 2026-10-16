import Link from "next/link";
import { Download, Paperclip } from "lucide-react";
import { OverBudgetBadge, StatusBadge } from "@/components/approvals/Badges";
import { DecisionPanel, WithdrawButton } from "@/components/approvals/DecisionPanel";
import { Timeline } from "@/components/approvals/Timeline";
import { TYPE_LABEL, budgetWarning } from "@/lib/approvals/calc";
import { formatDate, formatDateTime, formatINR, isoToDisplay } from "@/lib/approvals/format";
import type { AttachmentRow, RequestDetail, StepRow } from "@/lib/approvals/request-queries";

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
          <a className="btn btn-ghost btn-sm" href={`/api/approvals/files/${a.id}`} target="_blank" rel="noopener noreferrer">Open</a>
          <a className="btn btn-ghost btn-sm" href={`/api/approvals/files/${a.id}?download=1`} aria-label={`Download ${a.fileName}`}><Download size={14} /></a>
        </li>
      ))}
    </ul>
  );
}

/** Everything about one request, read only, with the approver's controls when it is waiting for them. */
export function RequestDetailView({ d }: { d: RequestDetail }) {
  const e = d.expenditure;
  const b = e ?? d.hr?.budget ?? null; // an HR request that carries an amount has a budget too
  const name = d.hr ? `${d.hr.firstName} ${d.hr.lastName}` : d.requesterName;
  const warning = b ? budgetWarning(b.now) : null;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="!text-xl">{d.requestNo ?? "Request"}</h2>
        <span className="text-[var(--z-muted)]">{TYPE_LABEL[d.type]}</span>
        <StatusBadge status={d.status} />
        {d.overBudget && <OverBudgetBadge />}
        {d.can.withdraw && <span className="ml-auto"><WithdrawButton id={d.id} /></span>}
      </div>

      {d.status === "returned" && (
        <div role="status" className="apr-notice max-w-3xl space-y-2">
          <p><b>Returned for corrections{d.returned ? ` by ${d.returned.byName}` : ""}.</b></p>
          {d.returned?.comment && <p className="whitespace-pre-wrap">&ldquo;{d.returned.comment}&rdquo;</p>}
          {d.can.edit ? (
            <p><Link href={`/approvals/requests/${d.id}/edit`} className="btn btn-primary btn-sm">Edit and resubmit</Link></p>
          ) : (
            <p>Waiting for {d.requesterName} to correct it. It goes back to {d.returned?.byName ?? "the same approver"} when they do.</p>
          )}
        </div>
      )}

      {d.can.decide && <DecisionPanel id={d.id} commentToApprove={d.can.commentToApprove} mode={d.can.mode} />}

      <section aria-labelledby="req-details">
        <h2 id="req-details" className="mb-3">Request</h2>
        <dl className="zdl">
          <Item label="Name">{name}</Item>
          <Item label="Email">{d.requesterEmail}</Item>
          <Item label="Category">{d.hr?.categoryName ?? e?.categoryName}</Item>
          {e && <Item label="Branch Name">{e.branchName}</Item>}
          {e && <Item label="Nature of Expenditure"><span className="whitespace-pre-wrap">{e.nature}</span></Item>}
          <Item label="Date of Request">{formatDateTime(d.requestedAt)}</Item>
          <Item label="Financial year">{d.financialYear}</Item>
          <Item label="Amount">{money(d.amountPaise)}</Item>
          {d.hr?.branchName && <Item label="Branch Name">{d.hr.branchName}</Item>}
          {d.hr?.budgetCategoryName && <Item label="Budget category">{d.hr.budgetCategoryName}</Item>}
          {d.hr && <Item label="Description"><span className="whitespace-pre-wrap">{d.hr.description}</span></Item>}
          {e && <Item label="Vendor Name"><span className="whitespace-pre-wrap">{e.vendorName}</span></Item>}
          {e && d.type === "expenditure_small" && <Item label="Date of expense">{isoToDisplay(e.expenseDate)}</Item>}
          {e?.publicationType && <Item label="Type of Publication">{e.publicationType}</Item>}
          {e?.publication && <Item label="Publication">{e.publication}</Item>}
          {e && d.type === "expenditure_small" && <Item label="Date of Tax Invoice">{isoToDisplay(e.taxInvoiceDate)}</Item>}
        </dl>
      </section>

      {b && (
        <section aria-labelledby="req-budget">
          <h2 id="req-budget" className="mb-3">Budget</h2>
          {warning && d.status === "pending" && <p className="apr-notice mb-3 max-w-2xl">{warning}</p>}
          <div className="table-wrap max-w-2xl">
            <table>
              <thead><tr><th></th><th className="text-right">Allocated</th><th className="text-right">Used (approved)</th><th className="text-right">Waiting</th><th className="text-right">Left</th></tr></thead>
              <tbody>
                <tr>
                  <td className="font-bold">When submitted</td>
                  <td className="text-right">{b.snapshot.allocatedPaise == null ? "No budget" : money(b.snapshot.allocatedPaise)}</td>
                  <td className="text-right">{b.snapshot.allocatedPaise == null || b.snapshot.availablePaise == null ? "—" : money(b.snapshot.allocatedPaise - b.snapshot.availablePaise)}</td>
                  <td className="text-right">—</td>
                  <td className={`text-right ${b.snapshot.availablePaise != null && b.snapshot.availablePaise < (d.amountPaise ?? 0) ? "zf-neg" : ""}`}>
                    {b.snapshot.availablePaise == null ? "—" : `${money(b.snapshot.availablePaise)} → ${money(b.snapshot.afterPaise)} after this request`}
                  </td>
                </tr>
                <tr>
                  <td className="font-bold">Now</td>
                  <td className="text-right">{b.now.noBudget ? "No budget" : money(b.now.allocatedPaise)}</td>
                  <td className="text-right">{money(b.now.spentPaise)}</td>
                  <td className="text-right">{money(b.now.pendingPaise)}</td>
                  <td className="text-right">{b.now.noBudget ? "—" : money(b.now.allocatedPaise! - b.now.spentPaise)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-labelledby="req-files">
        <h2 id="req-files" className="mb-3">Attachments</h2>
        <div className="max-w-2xl"><Files items={d.attachments} /></div>
      </section>

      <section aria-labelledby="req-steps">
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

      <section aria-labelledby="req-timeline">
        <h2 id="req-timeline" className="mb-3">Timeline</h2>
        <Timeline events={d.events} />
      </section>
    </div>
  );
}
