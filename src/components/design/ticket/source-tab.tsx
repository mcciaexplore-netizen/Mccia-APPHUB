"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import type { TicketDetail } from "@/lib/design/detail";
import { cdrLinkTeamAction, decideCdrAction, requestCdrTeamAction, uploadCdrAction } from "@/lib/design/actions/tickets";
import { MAX_CDR_MB } from "@/lib/design/form";
import { formatBytes } from "@/lib/design/file-types";
import { FINISHED_STATUSES } from "@/lib/design/rules";
import { Badge, Card, Empty, formatDateTime } from "../ui";
import { FileDrop } from "../file-drop";
import { useAct } from "./use-act";
import type { Viewer } from "./ticket-view";

const TONE = { requested: "amber", approved: "blue", declined: "red", uploaded: "green" } as const;
const LABEL = { requested: "Waiting for a lead", approved: "Approved, to upload", declined: "Declined", uploaded: "Uploaded" } as const;

function UploadSlot({ requestId }: { requestId: string }) {
  const { act, pending } = useAct();
  const [fileId, setFileId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-3">
      <FileDrop purpose="cdr" maxFiles={1} maxMb={MAX_CDR_MB} multiple={false} onChange={(ids) => setFileId(ids[0] ?? null)} onBusy={setBusy} label="Drop the source file (CDR, PSD, AI, ZIP …)" hint={`One file, up to ${MAX_CDR_MB} MB`} />
      <button type="button" className="btn btn-sm ds-btn-navy mt-2" disabled={!fileId || busy || pending} onClick={() => act(() => uploadCdrAction(requestId, fileId!))}>
        Upload source file
      </button>
    </div>
  );
}

/** Tab 3: source files, released only after the design is delivered: asked for, approved by a lead, uploaded, downloaded (logged). */
export function SourceTab({ d, viewer }: { d: TicketDetail; viewer: Viewer }) {
  const { act, pending } = useAct();
  if (!FINISHED_STATUSES.includes(d.card.status)) {
    return (
      <Card title="Source files">
        <Empty title="Available after the design is delivered">Once the requester approves the design, they (or the team) can ask for its editable source files here.</Empty>
      </Card>
    );
  }
  const open = d.cdr.some((r) => r.status === "requested" || r.status === "approved");
  return (
    <Card
      title="Source files"
      actions={
        !open && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => act(() => requestCdrTeamAction(d.card.id))}>
            Ask for the source file
          </button>
        )
      }
    >
      {d.cdr.length === 0 ? (
        <p className="text-sm ds-muted">Nobody has asked for the source files yet.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {d.cdr.map((r) => (
            <li key={r.id} className="rounded-xl border border-[var(--ds-line)] p-4 text-sm">
              <p className="flex flex-wrap items-center gap-2">
                <Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge>
                <span className="ds-muted">
                  asked by {r.requestedBy ?? "Unknown"} · {formatDateTime(r.createdAt)}
                  {r.decidedBy ? ` · decided by ${r.decidedBy}` : ""}
                </span>
              </p>
              {r.status === "requested" && viewer.lead && (
                <div className="mt-3 flex gap-2">
                  <button type="button" className="btn btn-sm ds-btn-green" disabled={pending} onClick={() => act(() => decideCdrAction(r.id, true))}>
                    Approve
                  </button>
                  <button type="button" className="btn btn-sm ds-btn-outline-red" disabled={pending} onClick={() => act(() => decideCdrAction(r.id, false))}>
                    Decline
                  </button>
                </div>
              )}
              {r.status === "requested" && !viewer.lead && <p className="mt-2 text-xs ds-muted">A design lead approves it first; then the file can be uploaded.</p>}
              {r.status === "approved" && <UploadSlot requestId={r.id} />}
              {r.file && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm mt-3"
                  disabled={pending}
                  onClick={async () => {
                    const res = await act(() => cdrLinkTeamAction(r.id), { quiet: true });
                    if (res.ok) window.location.href = res.data;
                  }}
                >
                  <Download size={14} /> {r.file.fileName} ({formatBytes(r.file.size)})
                </button>
              )}
              {r.downloads.length > 0 && (
                <div className="mt-3">
                  <p className="ds-label">Downloads</p>
                  <ul className="mt-1 text-xs ds-muted">
                    {r.downloads.map((x, i) => (
                      <li key={i}>
                        {x.by ?? "Unknown"} · {formatDateTime(x.at)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
