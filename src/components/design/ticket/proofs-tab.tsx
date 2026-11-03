"use client";

import { useState } from "react";
import { Archive, Copy, Download, FileText, Library, Send, Undo2, X } from "lucide-react";
import { zipSync } from "fflate";
import { useToast } from "@/components/Toast";
import type { TicketDetail } from "@/lib/design/detail";
import { addProofAction, revokeReviewAction, sendForReviewAction } from "@/lib/design/actions/tickets";
import { addPastDesignAction, proofFromLibraryAction } from "@/lib/design/actions/library";
import { MAX_FILE_MB } from "@/lib/design/form";
import { formatBytes, isImage } from "@/lib/design/file-types";
import { APPROVAL_LABEL, FINISHED_STATUSES } from "@/lib/design/rules";
import { Badge, Card, Empty, formatDateTime } from "../ui";
import { FileDrop } from "../file-drop";
import { fileHref } from "../upload";
import { useAct } from "./use-act";
import { ProofCompare } from "./proof-compare";
import { LibraryPicker, type PickedFile } from "./library-picker";

const APPROVAL_TONE = { pending: "purple", approved: "green", changes_requested: "amber", revoked: "neutral", expired: "neutral" } as const;

/**
 * Tab 2: upload a proof (V1, V2 ...), or pick one from the library, and send it to the requester; each version with its review links;
 * compare; download all. A lead keeps a delivered design in the library's Past Designs.
 */
export function ProofsTab({ d, editable, lead }: { d: TicketDetail; editable: boolean; lead: boolean }) {
  const { act, pending } = useAct();
  const toast = useToast();
  const [fileId, setFileId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [send, setSend] = useState(true);
  const [dropKey, setDropKey] = useState(0);
  const [sent, setSent] = useState<{ link: string; emailedTo: string | null; version?: number } | null>(null);
  const [zipping, setZipping] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const images = d.proofs.filter((p) => isImage(p.file.mime));

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Link copied");
    } catch {
      toast.error("Copy failed. Select the link and copy it.");
    }
  };

  const downloadAll = async () => {
    setZipping(true);
    try {
      const entries: Record<string, Uint8Array> = {};
      for (const p of d.proofs) {
        const res = await fetch(fileHref(p.file.id));
        if (!res.ok) throw new Error();
        entries[`V${p.version}-${p.file.fileName}`] = new Uint8Array(await res.arrayBuffer());
      }
      const blob = new Blob([zipSync(entries, { level: 0 }) as Uint8Array<ArrayBuffer>], { type: "application/zip" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${d.card.number}-proofs.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch {
      // Storage refused a cross-site read (or a file is gone): download each file instead.
      toast.error("Could not make one ZIP; downloading each file instead.");
      d.proofs.forEach((p, i) => setTimeout(() => window.open(fileHref(p.file.id), "_blank"), i * 700));
    } finally {
      setZipping(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {editable && (
        <Card title="Upload a proof">
          {picked ? (
            <p className="flex items-center gap-2 rounded-lg border border-[var(--ds-navy-line)] bg-[var(--ds-navy-tint)] px-3 py-2 text-sm">
              <Library size={15} className="shrink-0 text-[var(--ds-navy)]" aria-hidden />
              <span className="min-w-0 flex-1 truncate">
                From the library: <strong>{picked.name}</strong> (version {(d.proofs[0]?.version ?? 0) + 1})
              </span>
              <button type="button" className="btn btn-ghost btn-sm" aria-label="Use an upload instead" onClick={() => setPicked(null)}>
                <X size={14} />
              </button>
            </p>
          ) : (
            <>
              <FileDrop key={dropKey} purpose="proof" maxFiles={1} maxMb={MAX_FILE_MB} multiple={false} onChange={(ids) => setFileId(ids[0] ?? null)} onBusy={setBusy} label="Drop the design here or click to browse" hint={`Version ${(d.proofs[0]?.version ?? 0) + 1} · one file, up to ${MAX_FILE_MB} MB`} />
              <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => setPicking(true)}>
                <Library size={14} /> Pick from library
              </button>
            </>
          )}
          <label className="ds-label mt-3 flex flex-col gap-1">
            Note for this version (optional)
            <textarea className="input min-h-16" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
          </label>
          <label className="mt-3 flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={send} onChange={(e) => setSend(e.target.checked)} className="h-4 w-4 accent-[#003F8A]" />
            Send for review now (the requester is emailed a link that works for 2 days)
          </label>
          <button
            type="button"
            className="btn btn-sm ds-btn-navy mt-4"
            disabled={(!picked && !fileId) || busy || pending}
            onClick={async () => {
              const r = await act(() => (picked ? proofFromLibraryAction(d.card.id, picked.fileId, note, send) : addProofAction(d.card.id, fileId!, note, send)));
              if (r.ok) {
                setPicked(null);
                toast.success(`Version ${r.data.version} uploaded${r.data.link ? " and sent for review" : ""}`);
                if (r.data.link) setSent({ link: r.data.link, emailedTo: r.data.emailedTo, version: r.data.version });
                setFileId(null);
                setNote("");
                setDropKey((k) => k + 1);
              }
            }}
          >
            {send ? "Upload and send for review" : "Upload"}
          </button>
        </Card>
      )}

      {picking && (
        <LibraryPicker
          onClose={() => setPicking(false)}
          onPick={(f) => {
            setPicked(f);
            setPicking(false);
          }}
        />
      )}

      {sent && (
        <div className="ds-card border-[rgba(16,185,129,0.35)] px-5 py-4 text-sm">
          <p className="font-semibold text-ink">{sent.emailedTo ? `Review link emailed to ${sent.emailedTo}.` : "Email is not set up or failed: share this link with the requester yourself."}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-[var(--ds-grey-tint)] px-2 py-1 text-xs">{sent.link}</code>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(sent.link)}>
              <Copy size={14} /> Copy
            </button>
          </div>
        </div>
      )}

      <Card
        title="Versions"
        actions={
          d.proofs.length > 0 && (
            <span className="flex flex-wrap gap-2">
              {lead && FINISHED_STATUSES.includes(d.card.status) && (
                d.inPastDesigns ? (
                  <Badge tone="green">In Past Designs</Badge>
                ) : (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => act(() => addPastDesignAction(d.card.id))}>
                    <Archive size={14} /> Add to Past Designs
                  </button>
                )
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={downloadAll} disabled={zipping}>
                <Download size={14} /> {zipping ? "Preparing…" : "Download all as ZIP"}
              </button>
            </span>
          )
        }
      >
        {d.proofs.length === 0 ? (
          <Empty title="No proofs yet">Upload the first version of the design above.</Empty>
        ) : (
          <ul className="flex flex-col gap-4">
            {d.proofs.map((p) => {
              const open = p.requests.find((r) => r.status === "pending");
              return (
                <li key={p.id} className="flex flex-col gap-3 rounded-xl border border-[var(--ds-line)] p-3 sm:flex-row">
                  <a href={fileHref(p.file.id, true)} target="_blank" rel="noopener noreferrer" className="grid h-28 w-full shrink-0 place-items-center overflow-hidden rounded-lg bg-[var(--ds-grey-tint)] sm:w-40">
                    {isImage(p.file.mime) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={fileHref(p.file.id, true)} alt={`Version ${p.version}`} className="h-full w-full object-contain" loading="lazy" />
                    ) : (
                      <FileText className="text-[var(--ds-navy)]" size={30} />
                    )}
                  </a>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Badge tone="blue">V{p.version}</Badge>
                      <a href={fileHref(p.file.id)} className="truncate text-sm font-semibold text-[var(--ds-navy)] hover:underline">
                        {p.file.fileName}
                      </a>
                      <span className="text-xs ds-muted">{formatBytes(p.file.size)}</span>
                    </p>
                    <p className="mt-1 text-xs ds-muted">
                      {p.createdBy ?? "Unknown"} · {formatDateTime(p.createdAt)}
                    </p>
                    {p.note && <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{p.note}</p>}
                    {p.requests.length === 0 ? (
                      <p className="mt-2 text-xs ds-muted">Not sent for review.</p>
                    ) : (
                      <ul className="mt-2 flex flex-col gap-1.5">
                        {p.requests.map((r) => (
                          <li key={r.id} className="text-xs">
                            <Badge tone={APPROVAL_TONE[r.status]}>{APPROVAL_LABEL[r.status]}</Badge>{" "}
                            <span className="ds-muted">
                              sent {formatDateTime(r.createdAt)}
                              {r.emailedTo ? ` to ${r.emailedTo}` : ""}
                              {r.status === "pending" ? ` · closes ${formatDateTime(r.expiresAt)}` : ""}
                              {r.decidedAt ? ` · ${r.decidedByName ?? "requester"}, ${formatDateTime(r.decidedAt)}` : ""}
                            </span>
                            {r.comment && <span className="mt-0.5 block whitespace-pre-wrap text-ink">“{r.comment}”</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                    {editable && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={pending}
                          onClick={async () => {
                            const r = await act(() => sendForReviewAction(p.id));
                            if (r.ok) {
                              toast.success("Sent for review");
                              setSent({ ...r.data, version: p.version });
                            }
                          }}
                        >
                          <Send size={14} /> {open ? "Send again" : "Send for review"}
                        </button>
                        {open && (
                          <button type="button" className="btn btn-sm ds-btn-outline-red" disabled={pending} onClick={() => act(() => revokeReviewAction(open.id))}>
                            <Undo2 size={14} /> Withdraw link
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {images.length >= 2 && <ProofCompare proofs={images.map((p) => ({ id: p.file.id, version: p.version }))} />}
    </div>
  );
}
