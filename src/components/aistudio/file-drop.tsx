"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, UploadCloud, X } from "lucide-react";
import type { FilePurpose } from "@/db/aistudio-schema";
import { formatBytes } from "@/lib/aistudio/file-types";
import { uploadFile } from "./upload";

export type Uploaded = { key: string; fileId: string | null; name: string; size: number; progress: number; error: string | null };

/**
 * Drag-and-drop area plus a picker (every file type is accepted). Each file starts uploading as soon as it is added; `onChange` gets the ids of the files that finished.
 * Shows each file's name, size and progress, with a remove button.
 */
export function FileDrop({
  purpose,
  maxFiles,
  maxMb,
  onChange,
  onBusy,
  label = "Drop files here or click to browse",
  hint,
  multiple = true,
}: {
  purpose: FilePurpose;
  maxFiles: number;
  maxMb: number;
  onChange: (fileIds: string[]) => void;
  onBusy?: (busy: boolean) => void;
  label?: string;
  hint?: string;
  multiple?: boolean;
}) {
  const [items, setItems] = useState<Uploaded[]>([]);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Tell the form after each change (not inside a state update, so the form re-renders on its own turn).
  const handlers = useRef({ onChange, onBusy });
  useEffect(() => {
    handlers.current = { onChange, onBusy };
  });
  useEffect(() => {
    handlers.current.onChange(items.filter((i) => i.fileId && !i.error).map((i) => i.fileId!));
    handlers.current.onBusy?.(items.some((i) => !i.fileId && !i.error));
  }, [items]);
  const update = (key: string, patch: Partial<Uploaded>) => setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const add = (files: FileList | File[]) => {
    setProblem(null);
    const list = [...files];
    const room = maxFiles - items.filter((i) => !i.error).length;
    if (list.length > room) setProblem(`You can attach up to ${maxFiles} file${maxFiles === 1 ? "" : "s"}.`);
    const accepted: Uploaded[] = [];
    for (const f of list.slice(0, Math.max(0, room))) {
      const key = `${f.name}-${f.size}-${Math.random()}`;
      const tooBig = f.size > maxMb * 1048576;
      const item: Uploaded = { key, fileId: null, name: f.name, size: f.size, progress: 0, error: tooBig ? `Larger than ${maxMb} MB` : null };
      accepted.push(item);
      if (!item.error)
        uploadFile(purpose, f, (p) => update(key, { progress: p }))
          .then((r) => update(key, { fileId: r.fileId, progress: 100 }))
          .catch((e: Error) => update(key, { error: e.message }));
    }
    setItems((cur) => [...cur, ...accepted]);
  };

  const remove = (key: string) => setItems((cur) => cur.filter((i) => i.key !== key));

  const full = items.filter((i) => !i.error).length >= maxFiles;

  return (
    <div>
      <div
        className="ai-drop flex cursor-pointer flex-col items-center justify-center gap-2 px-6 py-8 text-center"
        data-over={over}
        role="button"
        tabIndex={0}
        aria-disabled={full}
        onClick={() => !full && input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !full && (e.preventDefault(), input.current?.click())}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!full) add(e.dataTransfer.files);
        }}
      >
        <UploadCloud className="text-[var(--ai-navy)]" size={28} aria-hidden />
        <p className="text-sm font-semibold text-ink">{full ? `${maxFiles} file${maxFiles === 1 ? "" : "s"} added` : label}</p>
        <p className="text-xs ai-muted">{hint ?? `Up to ${maxFiles} file${maxFiles === 1 ? "" : "s"}, ${maxMb} MB each`}</p>
        <input
          ref={input}
          type="file"
          className="sr-only"
          multiple={multiple && maxFiles > 1}
          onChange={(e) => {
            if (e.target.files) add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {problem && <p className="mt-2 text-xs text-[var(--ai-red)]">{problem}</p>}
      {items.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {items.map((i) => (
            <li key={i.key} className="flex items-center gap-3 rounded-lg border border-[var(--ai-line)] bg-white px-3 py-2 text-sm">
              {i.fileId || i.error ? <FileText size={16} className="shrink-0 text-[var(--ai-navy)]" /> : <Loader2 size={16} className="shrink-0 animate-spin text-[var(--ai-navy)]" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{i.name}</span>
                <span className={`block text-xs ${i.error ? "text-[var(--ai-red)]" : "ai-muted"}`}>{i.error ?? `${formatBytes(i.size)}${i.fileId ? " · uploaded" : ` · ${i.progress}%`}`}</span>
              </span>
              <button type="button" className="rounded p-1 text-subtle hover:bg-alt hover:text-ink" aria-label={`Remove ${i.name}`} onClick={() => remove(i.key)}>
                <X size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
