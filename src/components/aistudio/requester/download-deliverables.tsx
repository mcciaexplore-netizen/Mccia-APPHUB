"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { zipSync } from "fflate";
import { fileHref } from "../ui";

/** "Download deliverables": one file downloads as it is; several come as one ZIP (or one by one if the browser cannot read them). */
export function DownloadDeliverables({ number, files, label = "Download deliverables" }: { number: string; files: { fileId: string; fileName: string }[]; label?: string }) {
  const [busy, setBusy] = useState(false);
  if (!files.length) return null;
  if (files.length === 1)
    return (
      <a href={fileHref(files[0].fileId)} className="btn btn-sm ai-btn-green" onClick={(e) => e.stopPropagation()}>
        <Download size={14} /> {label}
      </a>
    );
  const zip = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    try {
      const entries: Record<string, Uint8Array> = {};
      for (const f of files) {
        const res = await fetch(fileHref(f.fileId));
        if (!res.ok) throw new Error();
        entries[f.fileName in entries ? `${f.fileId.slice(0, 6)}-${f.fileName}` : f.fileName] = new Uint8Array(await res.arrayBuffer());
      }
      const blob = new Blob([zipSync(entries, { level: 0 }) as Uint8Array<ArrayBuffer>], { type: "application/zip" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${number}-deliverables.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch {
      files.forEach((f, i) => setTimeout(() => window.open(fileHref(f.fileId), "_blank"), i * 700));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className="btn btn-sm ai-btn-green" onClick={zip} disabled={busy}>
      <Download size={14} /> {busy ? "Preparing…" : `${label} (${files.length})`}
    </button>
  );
}
