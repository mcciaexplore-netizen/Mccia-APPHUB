"use client";

import { useState } from "react";
import { requestChangesAction } from "@/lib/design/actions/tickets";
import { MAX_FILES, MAX_FILE_MB } from "@/lib/design/form";
import { FileDrop } from "../file-drop";
import { useAct } from "./use-act";

/**
 * The panel under a proof where a design lead sends it back: a required comment and any number of files (up to the usual limit), then
 * Send Request or Cancel. Files upload as they are added; Send waits for them.
 */
export function RequestChangesPanel({ proofId, label, onClose }: { proofId: string; /** What is being sent back: "V2" or "Flyer · V2". */ label: string; onClose: () => void }) {
  const { act, pending } = useAct();
  const [comment, setComment] = useState("");
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const id = `rc-${proofId}`;

  return (
    <form
      className="mt-3 flex flex-col gap-3 rounded-lg border border-[var(--ds-navy-line)] bg-[var(--ds-navy-tint)] p-4"
      aria-label={`Request changes on ${label}`}
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await act(() => requestChangesAction(proofId, comment, fileIds));
        if (r.ok) onClose();
      }}
    >
      <p className="text-sm font-semibold text-ink">Request changes on {label}</p>
      <label htmlFor={id} className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-ink">
          Add comment <span className="text-[var(--ds-red)]" aria-hidden>*</span>
        </span>
        <textarea id={id} className="input min-h-28 bg-white" required maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Describe what needs to be changed..." />
      </label>
      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-ink">
          Add file <span className="font-normal ds-muted">(optional)</span>
        </span>
        <FileDrop purpose="attachment" maxFiles={MAX_FILES} maxMb={MAX_FILE_MB} onChange={setFileIds} onBusy={setBusy} label="Attach files (images, PDF, Word or any document)" hint={`Up to ${MAX_FILES} files, ${MAX_FILE_MB} MB each`} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-sm ds-btn-navy" disabled={pending || busy || !comment.trim()}>
          {busy ? "Waiting for files to upload…" : pending ? "Sending…" : "Send Request"}
        </button>
        <button type="button" className="btn btn-sm btn-ghost bg-white" disabled={pending} onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}
