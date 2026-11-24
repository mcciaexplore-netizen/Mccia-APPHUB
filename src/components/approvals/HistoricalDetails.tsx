import { formatDateTime } from "@/lib/approvals/format";
import type { HistoricalView } from "@/lib/approvals/historical/view";

/** Read-only pieces of an opened historical ticket (one imported from an older approval system). Server-rendered, no hooks. */

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (<><dt>{label}</dt><dd>{children || <span className="text-[var(--z-muted)]">Not recorded</span>}</dd></>);
}

/** The line under the ticket's heading: where it came from, and that it is an archive. */
export function HistoricalNotice({ h }: { h: HistoricalView }) {
  return (
    <div role="note" className="apr-notice max-w-3xl" data-testid="historical-notice">
      <p>
        <b>Historical record from {h.systemLabel}</b> (ID {h.legacyId}, status there: <b>{h.sourceStatus || "not given"}</b>), imported on{" "}
        {formatDateTime(h.importedAt)} by {h.importedByName}.
      </p>
      <p className="mt-1 text-sm">It is archived and read-only: it was never sent to an approver in the hub, nobody was notified, and nobody can approve, reject or change it here.</p>
    </div>
  );
}

/**
 * What the source shows about the approval, in time order, kept apart from the hub's own timeline. Only what the source records: a time
 * with no person stays without one.
 */
export function HistoricalTimeline({ h }: { h: HistoricalView }) {
  if (h.timeline.length === 0) return <p className="text-[var(--z-muted)]">The source records nothing about this record&apos;s approval.</p>;
  const dg = h.timeline.some((t) => t.key === "dg");
  return (
    <>
      <ol className="zt" data-testid="historical-timeline">
        {h.timeline.map((t, i) => (
          <li key={`${t.key}-${i}`} className="zt-item">
            <span className="zt-dot" data-kind={t.key === "submitted" ? "submitted" : "assigned"} aria-hidden />
            <p className="font-bold">{t.label}</p>
            <p className="text-xs text-[var(--z-muted)]">
              {t.at ? formatDateTime(t.at) : "No time recorded"}
              {t.sourceText && t.at && formatDateTime(t.at) !== t.sourceText ? ` (written there as ${t.sourceText})` : ""}
              {" · "}{t.actor ? `by ${t.actor}` : "who acted is not recorded"}
            </p>
            {t.note && <p className="mt-1 text-sm text-[var(--z-muted)]">{t.note}</p>}
          </li>
        ))}
      </ol>
      {!dg && <p className="mt-1 text-sm text-[var(--z-muted)]" data-testid="historical-no-dg">No DG action is recorded in the source.</p>}
    </>
  );
}

/** Everything the source had that the ordinary details do not already show, under "Historical Approval Details". */
export function HistoricalDetails({ h }: { h: HistoricalView }) {
  return (
    <details open className="max-w-4xl rounded-[12px] border border-[var(--z-line)] px-4 py-3" data-testid="historical-details">
      <summary className="cursor-pointer text-lg font-bold">Historical Approval Details</summary>
      <dl className="zdl mt-4">
        <Item label="Source system">{h.systemLabel}</Item>
        <Item label={`ID in ${h.systemLabel}`}><span className="font-mono">{h.legacyId}</span></Item>
        <Item label={`Status in ${h.systemLabel}`}><b>{h.sourceStatus}</b></Item>
        <Item label="Requester there">{h.requester.name}{h.requester.email ? ` · ${h.requester.email}` : ""}</Item>
        <Item label="Requester in the hub">{h.requester.linkedName ? `Linked to ${h.requester.linkedName}` : <span>Not linked{h.requester.note ? <span className="block text-sm text-[var(--z-muted)]">{h.requester.note}</span> : null}</span>}</Item>
        <Item label={`Category in ${h.systemLabel}`}>{h.category.name}{h.category.sourceId ? <span className="ml-2 font-mono text-xs text-[var(--z-muted)]">ID {h.category.sourceId}</span> : null}</Item>
        {h.category.hubName && h.category.hubName.trim() !== h.category.name.trim() && <Item label="Filed under (hub)">{h.category.hubName}</Item>}
        {h.sourceDates.map((f) => <Item key={f.label} label={`${f.label} (as written there)`}>{f.value}</Item>)}
        {h.extra.map((f) => <Item key={`x-${f.label}`} label={f.label}><span className="whitespace-pre-wrap">{f.value}</span></Item>)}
        <Item label="Imported">{formatDateTime(h.importedAt)} by {h.importedByName}, from {h.fileName}</Item>
      </dl>
      {h.notes.length > 0 && (
        <div className="mt-4" data-testid="historical-notes">
          <p className="font-bold">Notes from the import</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{h.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>
      )}
      {h.sourceRecord != null && (
        <details className="mt-4 text-sm" data-testid="historical-source">
          <summary className="apr-link cursor-pointer">The original record, as it was in the file (administrators only)</summary>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-sm bg-[var(--c-bg-alt,#f6f7f9)] p-3 text-xs">{JSON.stringify(h.sourceRecord, null, 2)}</pre>
        </details>
      )}
    </details>
  );
}
