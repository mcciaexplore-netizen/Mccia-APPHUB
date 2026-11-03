import { CheckCircle2 } from "lucide-react";
import type { AuditDto } from "@/lib/design/detail";
import { Card, formatDateTime } from "../ui";

const KEY_LABEL: Record<string, string> = {
  status: "Status",
  assignee: "Assignee",
  priority: "Priority",
  deadline: "Deadline",
  figma: "Figma link",
  estimate: "Estimate",
  tags: "Tags",
  proof_version: "Proof version",
  file_name: "File",
  reason: "Reason",
  comment: "Comment",
  question: "Question",
  text: "Text",
  new_version: "New version",
  revision_of: "Revision of",
  via: "Via",
  designs: "Designs",
  files: "Files",
};

const show = (v: unknown): string => {
  if (v == null || v === "") return "–";
  if (Array.isArray(v)) return v.map(show).join(", ");
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return formatDateTime(v);
  if (typeof v === "string" && /^[0-9a-f-]{36}$/.test(v)) return "someone on the team";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

/** One line per detail: "Status: Assigned → In progress", "Comment: …". Internal keys (ids, dedupe keys) are skipped. */
function detailLines(details: Record<string, unknown>): string[] {
  return Object.entries(details)
    .filter(([k]) => k !== "key" && k !== "auto")
    .map(([k, v]) => {
      const label = KEY_LABEL[k] ?? k.replace(/_/g, " ");
      if (v && typeof v === "object" && !Array.isArray(v) && "from" in v && "to" in v) {
        const c = v as { from: unknown; to: unknown };
        return `${label}: ${show(c.from)} → ${show(c.to)}`;
      }
      return `${label}: ${show(v)}`;
    });
}

/** The ticket's history, newest first, with who accepted it from Pending Review shown above it all. */
export function AuditLog({ items }: { items: AuditDto[] }) {
  const accepted = items.find((a) => a.action === "Accepted");
  return (
    <Card title="History">
      {accepted && (
        <p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-[var(--ds-green)] bg-[#ecfdf5] px-3 py-2 text-sm">
          <CheckCircle2 size={16} className="shrink-0 text-[var(--ds-green-text)]" aria-hidden />
          <strong className="text-ink">Accepted by {accepted.who}</strong>
          <span className="ds-muted">· {formatDateTime(accepted.at)}</span>
        </p>
      )}
      {items.length === 0 ? (
        <p className="text-sm ds-muted">Nothing yet.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {items.map((a) => (
            <li key={a.id} className="border-l-2 border-[var(--ds-navy-line)] pl-3 text-sm">
              <p className="text-ink">
                <strong>{a.action}</strong> <span className="ds-muted">· {a.who} · {formatDateTime(a.at)}</span>
              </p>
              {detailLines(a.details).map((l) => (
                <p key={l} className="break-words text-xs ds-muted">
                  {l}
                </p>
              ))}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
