"use client";

import { useEffect, useState } from "react";
import { FileText, Loader2, Search } from "lucide-react";
import { Modal } from "@/components/Modal";
import type { LibraryItemDto } from "@/lib/design/library";
import { libraryPickerAction } from "@/lib/design/actions/library";
import { formatBytes, isImage } from "@/lib/design/file-types";
import { Badge } from "../ui";
import { fileHref } from "../upload";

export type PickedFile = { fileId: string; name: string };

/** "Pick from library": search the library and choose a file (its current version) to use instead of uploading one. */
export function LibraryPicker({ onPick, onClose }: { onPick: (f: PickedFile) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<LibraryItemDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Searches as the person types, a moment after they stop.
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const r = await libraryPickerAction(q);
      if (!live) return;
      if (r.ok) {
        setItems(r.data);
        setError(null);
      } else setError(r.error);
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  return (
    <Modal title="Pick from library" onClose={onClose}>
      <label className="relative block">
        <span className="sr-only">Search the library</span>
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle" />
        <input className="input pl-9" autoFocus placeholder="Search names and tags" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="mt-3 max-h-[60vh] overflow-y-auto">
        {error ? (
          <p className="py-6 text-center text-sm text-[var(--ds-red)]">{error}</p>
        ) : items === null ? (
          <p className="flex items-center justify-center gap-2 py-6 text-sm ds-muted">
            <Loader2 size={14} className="animate-spin" /> Loading the library…
          </p>
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm ds-muted">{q ? "Nothing matches." : "The library is empty."}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {items.map((i) =>
              i.current ? (
                <li key={i.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 rounded-lg border border-[var(--ds-line)] p-2 text-left hover:border-[var(--ds-navy)] hover:bg-[var(--ds-navy-tint)]"
                    onClick={() => onPick({ fileId: i.current!.fileId, name: i.name })}
                  >
                    <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded bg-[var(--ds-grey-tint)]">
                      {isImage(i.current.mime) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={fileHref(i.current.fileId, true)} alt="" className="h-full w-full object-contain" loading="lazy" />
                      ) : (
                        <FileText size={20} className="text-[var(--ds-navy)]" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{i.name}</span>
                      <span className="block truncate text-xs ds-muted">
                        {i.current.fileName} · {formatBytes(i.current.size)}
                      </span>
                    </span>
                    {i.isApprovedFinal && <Badge tone="green">Final</Badge>}
                  </button>
                </li>
              ) : null,
            )}
          </ul>
        )}
      </div>
    </Modal>
  );
}
