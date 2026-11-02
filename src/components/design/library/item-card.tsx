"use client";

import { useState } from "react";
import { Download, FileText, History, Pencil, Trash2, Upload } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { Modal } from "@/components/Modal";
import type { LibraryItemDto } from "@/lib/design/library";
import { deleteItemAction } from "@/lib/design/actions/library";
import { formatBytes, isImage } from "@/lib/design/file-types";
import { istDate } from "@/lib/design/rules";
import { useAct } from "../ticket/use-act";
import { Badge, formatDateTime, formatDay } from "../ui";
import { fileHref } from "../upload";
import { ItemForm, VersionForm } from "./item-form";

/** One library item: preview, details, the current file, and its versions, edit, replace and delete. */
export function ItemCard({ item, folderName, showFolder }: { item: LibraryItemDto; folderName: string | null; showFolder: boolean }) {
  const confirm = useConfirm();
  const { act, pending } = useAct();
  const [mode, setMode] = useState<"edit" | "version" | "history" | null>(null);
  const cur = item.current;
  const expired = !!item.expiryDate && item.expiryDate < istDate();

  return (
    <li className="ds-card ds-card-hover flex flex-col overflow-hidden">
      <a href={cur ? fileHref(cur.fileId, true) : undefined} target="_blank" rel="noopener noreferrer" className="grid h-40 place-items-center bg-[var(--ds-grey-tint)]">
        {cur && isImage(cur.mime) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={fileHref(cur.fileId, true)} alt={item.name} className="h-full w-full object-contain" loading="lazy" />
        ) : (
          <FileText size={34} className="text-[var(--ds-navy)]" />
        )}
      </a>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 className="min-w-0 flex-1 truncate text-sm font-bold text-ink" title={item.name}>
            {item.name}
          </h3>
          {item.isApprovedFinal && <Badge tone="green">Approved final</Badge>}
          {cur && <Badge tone="blue">V{cur.version}</Badge>}
        </div>
        {showFolder && folderName && <p className="text-xs ds-muted">in {folderName}</p>}
        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.tags.map((t) => (
              <Badge key={t}>{t}</Badge>
            ))}
          </div>
        )}
        {item.expiryDate && <p className={`text-xs ${expired ? "font-semibold text-[var(--ds-red)]" : "ds-muted"}`}>{expired ? "Expired" : "Expires"} {formatDay(item.expiryDate)}</p>}
        {item.usageRightsNote && <p className="line-clamp-3 text-xs text-ink">{item.usageRightsNote}</p>}
        {cur && (
          <a href={fileHref(cur.fileId)} className="mt-auto inline-flex items-center gap-1.5 truncate text-xs font-semibold text-[var(--ds-navy)] hover:underline">
            <Download size={13} /> {cur.fileName} ({formatBytes(cur.size)})
          </a>
        )}
        <div className="flex flex-wrap gap-1 border-t border-[var(--ds-line)] pt-2">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode("version")}>
            <Upload size={13} /> Replace
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode("history")} aria-label={`Versions of ${item.name}`}>
            <History size={13} /> {item.versions.length}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode("edit")} aria-label={`Edit ${item.name}`}>
            <Pencil size={13} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm text-[var(--ds-red)]"
            aria-label={`Delete ${item.name}`}
            disabled={pending}
            onClick={async () => {
              if (await confirm({ title: `Delete ${item.name}?`, message: "It is removed from the library, with its versions.", confirmLabel: "Delete", danger: true })) act(() => deleteItemAction(item.id));
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      {mode === "edit" && <ItemForm folderId={item.folderId} item={item} onClose={() => setMode(null)} />}
      {mode === "version" && <VersionForm item={item} onClose={() => setMode(null)} />}
      {mode === "history" && (
        <Modal title={`Versions of ${item.name}`} onClose={() => setMode(null)}>
          <ul className="flex flex-col divide-y divide-[var(--ds-line)]">
            {item.versions.map((v) => (
              <li key={v.versionId} className="flex items-center gap-3 py-2 text-sm">
                <Badge tone={v.version === cur?.version ? "blue" : "neutral"}>V{v.version}</Badge>
                <span className="min-w-0 flex-1">
                  <a href={fileHref(v.fileId)} className="block truncate font-medium text-[var(--ds-navy)] hover:underline">
                    {v.fileName}
                  </a>
                  <span className="text-xs ds-muted">
                    {formatBytes(v.size)} · {v.by ?? "Unknown"} · {formatDateTime(v.at)}
                    {v.note ? ` · ${v.note}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </li>
  );
}
