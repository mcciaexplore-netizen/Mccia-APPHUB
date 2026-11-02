"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Download, Eye, FileArchive, X } from "lucide-react";
import { decideMyRequest, requestSourceFiles, sourceFileLink } from "@/lib/design/actions/requests";
import type { MyRequest } from "@/lib/design/requester-queries";
import { FINISHED_STATUSES, timeLeft } from "@/lib/design/rules";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { fileHref } from "../upload";
import { Badge, StatusBadge, Steps, formatDateTime, formatDay } from "../ui";

/** One of the person's requests: progress, deadline, and the actions that apply at its stage. */

const CDR_TEXT = { requested: "Source files asked for, waiting for a design lead", approved: "Source files approved, the designer will upload them", declined: "Source-file request declined", uploaded: "Source files ready" } as const;

export function MyRequestCard({ r }: { r: MyRequest }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [changing, setChanging] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const approve = async () => {
    if (!(await confirm({ title: "Approve this design?", message: `Approving ${r.number} tells the design team it is final.`, confirmLabel: "Approve" }))) return;
    start(async () => {
      const res = await decideMyRequest(r.id, "approve", "");
      if (res.ok) {
        toast.success("Design approved. The team has been notified.");
        router.refresh();
      } else setError(res.error);
    });
  };
  const sendChanges = (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) return setError("Describe what needs to change.");
    start(async () => {
      const res = await decideMyRequest(r.id, "request_changes", comment);
      if (res.ok) {
        toast.success(res.data.newNumber ? `Changes requested. The team is working on ${res.data.newNumber}.` : "Changes requested.");
        setChanging(false);
        router.refresh();
      } else setError(res.error);
    });
  };
  const askSource = () =>
    start(async () => {
      const res = await requestSourceFiles(r.id);
      if (res.ok) {
        toast.success(res.message ?? "Asked for the source files.");
        router.refresh();
      } else toast.error(res.error);
    });
  const downloadSource = () =>
    start(async () => {
      const res = await sourceFileLink(r.cdr!.id);
      if (res.ok) window.location.href = res.data;
      else toast.error(res.error);
    });

  const finished = FINISHED_STATUSES.includes(r.status);
  const cdrOpen = r.cdr && (r.cdr.status === "requested" || r.cdr.status === "approved" || r.cdr.status === "uploaded");

  return (
    <article className="ds-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-[var(--ds-navy)]">{r.number}</p>
          <h2 className="text-[1.05rem] font-bold text-ink">{r.title}</h2>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {r.designs.map((d) => (
              <Badge key={d} tone="blue">
                {d}
              </Badge>
            ))}
          </div>
        </div>
        <StatusBadge status={r.status} />
      </div>

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {r.deliveryDate && (
          <span>
            <span className="ds-muted">Needed by </span>
            <span className="font-semibold text-ink">{formatDay(r.deliveryDate)}</span>
            {!finished && r.dueAt && r.status !== "declined" && r.status !== "superseded" && (
              <span className="ds-muted" suppressHydrationWarning>
                {" "}
                · {timeLeft(r.dueAt)}
              </span>
            )}
          </span>
        )}
        <span className="ds-muted">Asked {formatDay(r.createdAt)}</span>
      </div>

      {r.status !== "declined" && (
        <div className="mt-4">
          <Steps status={r.status} />
        </div>
      )}

      {r.status === "declined" && (
        <p className="mt-3 rounded-lg bg-[var(--ds-red-tint)] px-3 py-2 text-sm text-[var(--ds-red)]">
          Declined{r.declineReason ? `: ${r.declineReason}` : "."}
        </p>
      )}
      {r.status === "superseded" && <p className="mt-3 text-sm ds-muted">You asked for changes: the design team is working on the next version.</p>}

      {r.status === "in_review" && r.pending && (
        <div className="mt-4 rounded-lg border border-[var(--ds-navy-line)] bg-[var(--ds-navy-tint)] p-4">
          <p className="text-sm font-semibold text-ink">Version {r.pending.version} is ready for your review</p>
          <p className="text-xs ds-muted" suppressHydrationWarning>
            Please reply before {formatDateTime(r.pending.expiresAt)} IST.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={fileHref(r.pending.fileId, true)} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost bg-white">
              <Eye size={14} aria-hidden /> View design
            </a>
            <button type="button" className="btn btn-sm ds-btn-green" disabled={pending} onClick={approve}>
              <Check size={14} aria-hidden /> Approve
            </button>
            <button type="button" className="btn btn-sm ds-btn-outline-red" disabled={pending} onClick={() => setChanging((c) => !c)}>
              <X size={14} aria-hidden /> Request changes
            </button>
          </div>
          {changing && (
            <form onSubmit={sendChanges} className="mt-3 flex flex-col gap-2">
              <label htmlFor={`chg-${r.id}`} className="text-sm font-medium text-ink">
                What needs to change?
              </label>
              <textarea id={`chg-${r.id}`} className="input min-h-24 bg-white" required maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} />
              <button type="submit" className="btn btn-sm ds-btn-navy self-start" disabled={pending}>
                Send changes
              </button>
            </form>
          )}
        </div>
      )}

      {(finished || r.status === "delivered") && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {r.approved && (
            <a href={fileHref(r.approved.fileId)} className="btn btn-sm ds-btn-navy">
              <Download size={14} aria-hidden /> Download designs
            </a>
          )}
          {finished && !cdrOpen && (
            <button type="button" className="btn btn-sm btn-ghost" disabled={pending} onClick={askSource}>
              <FileArchive size={14} aria-hidden /> Request source files
            </button>
          )}
          {r.cdr?.status === "uploaded" && (
            <button type="button" className="btn btn-sm ds-btn-green" disabled={pending} onClick={downloadSource}>
              <Download size={14} aria-hidden /> Download source files
            </button>
          )}
        </div>
      )}
      {r.cdr && r.cdr.status !== "uploaded" && <p className="mt-2 text-xs ds-muted">{CDR_TEXT[r.cdr.status]}.</p>}
      {error && (
        <p role="alert" className="mt-3 text-sm text-[var(--ds-red)]">
          {error}
        </p>
      )}
    </article>
  );
}
