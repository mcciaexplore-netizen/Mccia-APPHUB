import Link from "next/link";
import { RecoverAttachment } from "@/components/approvals/RecoverAttachment";
import type { FileReference } from "@/lib/approvals/historical/attachments";

/**
 * The files imported records name (the old system exported their names only), on the Historical Import page: which ticket, and whether a
 * recovered copy is attached. Attaching one is a change by the Support Admin, so it is done here, with Administrator unlocked.
 */
export function HistoricalFiles({ files }: { files: FileReference[] }) {
  if (files.length === 0) return null;
  const missing = files.filter((f) => !f.attachmentId).length;
  return (
    <section aria-labelledby="hist-files" className="mt-8 space-y-3" data-testid="hist-files">
      <h2 id="hist-files" className="text-lg">Files named by imported records</h2>
      <p className="max-w-3xl text-sm text-subtle">
        The old system exported these files&apos; names only. {missing} of {files.length} {files.length === 1 ? "is" : "are"} not available. When a copy
        is found, attach it here to its ticket: it becomes an ordinary attachment, seen only by those who may see the ticket.
      </p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Ticket</th><th>ID there</th><th>Requester there</th><th>File named there</th><th>In the hub</th></tr></thead>
          <tbody>
            {files.map((f) => (
              <tr key={`${f.requestId}-${f.name}`} data-testid="hist-file-row" data-legacy-id={f.legacyId}>
                <td className="whitespace-nowrap"><Link className="apr-link" href={`/approvals/requests/${f.requestId}`}>{f.requestNo ?? "Ticket"}</Link></td>
                <td className="font-mono text-xs">{f.legacyId}</td>
                <td>{f.requesterName}</td>
                <td className="break-all font-mono text-xs">{f.name}</td>
                <td className="min-w-64">
                  {f.attachmentId
                    ? <span data-testid="hist-file-recovered">Recovered: <a className="apr-link" href={`/api/approvals/files/${f.attachmentId}`} target="_blank" rel="noopener noreferrer">{f.attachmentName}</a></span>
                    : <><span className="block text-sm text-subtle">Not available</span><RecoverAttachment requestId={f.requestId} reference={f.name} /></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
