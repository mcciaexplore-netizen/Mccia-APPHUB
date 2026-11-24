"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/components/approvals/api";
import { FileInput, type UploadedFile } from "@/components/approvals/FormFields";

/** For an administrator: attach a recovered copy of a file the source names (Zoho exported its name only) to a historical ticket. */
export function RecoverAttachment({ requestId, reference }: { requestId: string; reference: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return <button type="button" className="apr-link text-sm" onClick={() => setOpen(true)} data-testid="recover-open">Attach the recovered file</button>;
  }
  const attach = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const res = await api("POST", `/api/approvals/historical/requests/${requestId}/attachments`, { fileId: file.fileId, reference });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setOpen(false);
    setFile(null);
    router.refresh();
  };
  return (
    <div className="mt-2 max-w-md space-y-2" data-testid="recover-form">
      <FileInput label={`Recovered copy of ${reference}`} value={file} onChange={setFile} onBusy={setBusy} />
      <div className="flex gap-2">
        <button type="button" className="btn btn-primary btn-sm" disabled={!file || busy} onClick={() => void attach()} data-testid="recover-attach">Attach</button>
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => { setOpen(false); setFile(null); setError(null); }}>Cancel</button>
      </div>
      {error && <p className="zf-error" role="alert">{error}</p>}
    </div>
  );
}
