import { CheckCircle2, Download } from "lucide-react";
import type { AuditDto } from "@/lib/design/detail";
import { TEAM_CHANGES_ACTION } from "@/lib/design/rules";
import { Card, formatDateTime } from "../ui";
import { fileHref } from "../upload";

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
  item: "Design",
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
    .filter(([k]) => k !== "key" && k !== "auto" && k !== "attachments")
    .map(([k, v]) => {
      const label = KEY_LABEL[k] ?? k.replace(/_/g, " ");
      if (v && typeof v === "object" && !Array.isArray(v) && "from" in v && "to" in v) {
        const c = v as { from: unknown; to: unknown };
        return `${label}: ${show(c.from)} → ${show(c.to)}`;
      }
      return `${label}: ${show(v)}`;
    });
}

/** The files a lead attached to a change request, each with its download. */
const attachedFiles = (details: Record<string, unknown>): { id: string; name: string }[] =>
  Array.isArray(details.attachments) ? details.attachments.filter((f): f is { id: string; name: string } => !!f && typeof f.id === "string" && typeof f.name === "string") : [];

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
          {items.map((a) =>
            a.action === TEAM_CHANGES_ACTION ? (
              <li key={a.id} className="border-l-2 border-[var(--ds-amber)] pl-3 text-sm" data-testid="ds-team-changes">
                <p className="text-ink">
                  <strong>{a.who} requested changes</strong> <span className="ds-muted">· {formatDateTime(a.at)}</span>
                </p>
                {typeof a.details.item === "string" && <p className="text-xs ds-muted">Design: {a.details.item}</p>}
                {typeof a.details.comment === "string" && <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-[var(--ds-amber-tint)] px-3 py-2 text-ink">{a.details.comment}</p>}
                {attachedFiles(a.details).length > 0 && (
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {attachedFiles(a.details).map((f) => (
                      <li key={f.id}>
                        <a href={fileHref(f.id)} className="inline-flex items-center gap-1.5 break-all text-xs font-semibold text-[var(--ds-navy)] hover:underline">
                          <Download size={13} aria-hidden /> {f.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ) : (
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
            ),
          )}
        </ol>
      )}
    </Card>
  );
}
