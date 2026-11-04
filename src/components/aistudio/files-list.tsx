import { Download, FileText } from "lucide-react";
import { formatBytes } from "@/lib/aistudio/file-types";
import { fileHref, formatDateTime } from "./ui";

/** A list of stored files, each opening through the server's check (a 60-second link). `showBy`: who uploaded it and when. */
export function FilesList({ files, showBy = false }: { files: { fileId: string; fileName: string; size: number; at: string; by: string | null }[]; showBy?: boolean }) {
  if (!files.length) return <p className="text-sm ai-muted">None.</p>;
  return (
    <ul className="divide-y divide-[var(--ai-line)] rounded-lg border border-[var(--ai-line)]">
      {files.map((f) => (
        <li key={f.fileId} className="flex items-center gap-3 px-3 py-2 text-sm">
          <FileText size={16} className="shrink-0 text-[var(--ai-navy)]" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-ink">{f.fileName}</span>
            <span className="block text-xs ai-muted" suppressHydrationWarning>
              {formatBytes(f.size)}
              {showBy ? ` · ${f.by ?? "Unknown"} · ${formatDateTime(f.at)}` : ""}
            </span>
          </span>
          <a href={fileHref(f.fileId)} className="btn btn-ghost btn-sm" aria-label={`Download ${f.fileName}`}>
            <Download size={14} />
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Reference links, each opening in a new tab. */
export function LinksList({ links }: { links: string[] }) {
  if (!links.length) return <p className="text-sm ai-muted">None.</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {links.map((l) => (
        <li key={l} className="truncate">
          <a href={l} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-[var(--ai-navy)] hover:underline">
            {l}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** The progress timeline: each step with the time it was reached, or still to come. */
export function Timeline({ steps }: { steps: { label: string; at: string | null; done: boolean; current: boolean }[] }) {
  return (
    <ol className="flex flex-col gap-2.5 text-sm">
      {steps.map((s) => (
        <li key={s.label} className="flex items-center gap-2.5">
          <span aria-hidden className="w-5 text-center">{s.done ? "✅" : s.current ? "🔄" : "⏳"}</span>
          <span className={s.done || s.current ? "font-semibold text-ink" : "ai-muted"}>{s.label}</span>
          {s.at && (s.done || s.current) && (
            <span className="text-xs ai-muted" suppressHydrationWarning>
              — {formatDateTime(s.at)}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
