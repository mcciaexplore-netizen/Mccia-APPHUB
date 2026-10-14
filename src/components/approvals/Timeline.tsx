import { formatDateTime } from "@/lib/approvals/format";
import type { EventRow } from "@/lib/approvals/request-queries";

const KIND: Record<string, string> = {
  submitted: "submitted", approved: "approved", rejected: "rejected", withdrawn: "withdrawn", assigned: "assigned", viewed: "assigned", comment: "assigned",
};

const sentence = (e: EventRow): string => {
  switch (e.action) {
    case "submitted": return `Submitted by ${e.actorName}`;
    case "assigned": return e.comment ?? "Sent for approval";
    case "viewed": return `Opened by ${e.actorName}`;
    case "approved": return `Approved by ${e.actorName}`;
    case "rejected": return `Rejected by ${e.actorName}`;
    case "withdrawn": return `Withdrawn by ${e.actorName}`;
    case "comment": return `${e.actorName} commented`;
    default: return `${e.actorName}: ${e.action}`;
  }
};

/** What happened to a request, oldest first: who, what, when, and any comment. Teal is submitted, green approved, red rejected. */
export function Timeline({ events }: { events: EventRow[] }) {
  if (events.length === 0) return <p className="text-[var(--z-muted)]">Nothing has happened yet.</p>;
  return (
    <ol className="zt">
      {events.map((e) => (
        <li key={e.id} className="zt-item">
          <span className="zt-dot" data-kind={KIND[e.action] ?? "assigned"} aria-hidden />
          <p className="font-bold">{sentence(e)}</p>
          <p className="text-xs text-[var(--z-muted)]">{formatDateTime(e.createdAt)}</p>
          {e.comment && e.action !== "assigned" && <p className="mt-1 whitespace-pre-wrap text-sm">&ldquo;{e.comment}&rdquo;</p>}
        </li>
      ))}
    </ol>
  );
}
