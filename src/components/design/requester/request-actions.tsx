"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Download, Eye, FileArchive, X } from "lucide-react";
import { decideMyRequest, requestSourceFiles, sourceFileLink } from "@/lib/design/actions/requests";
import type { MyRequest } from "@/lib/design/requester-queries";
import { FINISHED_STATUSES } from "@/lib/design/rules";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { fileHref } from "../upload";
import { formatDateTime } from "../ui";

/**
 * What a requester can do with one of their requests, at its stage: approve or ask for changes while it is in review; download the
 * approved design and ask for (then download) its source files once it is delivered. Used on My Requests and on the request's own page.
 */

const CDR_TEXT = { requested: "Source files asked for, waiting for a design lead", approved: "Source files approved, the designer will upload them", declined: "Source-file request declined", uploaded: "Source files ready" } as const;

export function RequestActions({ r, viewLink = true }: { r: Pick<MyRequest, "id" | "number" | "status" | "pending" | "approved" | "cdr">; viewLink?: boolean }) {
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
    <>
      {r.status === "in_review" && r.pending && (
        <div className="mt-4 rounded-lg border border-[var(--ds-navy-line)] bg-[var(--ds-navy-tint)] p-4">
          <p className="text-sm font-semibold text-ink">Version {r.pending.version} is ready for your review</p>
          <p className="text-xs ds-muted" suppressHydrationWarning>
            Please reply before {formatDateTime(r.pending.expiresAt)} IST.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {viewLink && (
              <a href={fileHref(r.pending.fileId, true)} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost bg-white">
                <Eye size={14} aria-hidden /> View design
              </a>
            )}
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
    </>
  );
}
