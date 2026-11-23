"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, Eye, File as FileIcon, FileText, Pencil, Presentation, RefreshCw, Trash2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/components/Toast";
import { convertFileAction, createDocumentAction, removeProjectFileAction } from "@/lib/eru/actions/workspace";
import { fileActions, fileKind, formatBytes, type FileKind } from "@/lib/eru/file-types";
import type { FileSummary } from "@/lib/eru/queries";
import type { Slide, SlidePara } from "@/lib/eru/convert";
import { fileHref, formatDateTime } from "../ui";
import { useAct } from "../use-act";

/**
 * A project's files, each as a card: its type's icon, name, size, upload date and who uploaded it, and what can be done with it
 * (file-types.ts fileActions): Download; Preview (PDF pages, a Word file read only, a PowerPoint one slide at a time); Edit in editor (Word,
 * after a confirmation: the Word file is kept beside the new editable document); Convert to PDF / Convert to Word (saved as a new file card,
 * the original kept). Nothing is ever converted on upload.
 */

const ICON: Record<FileKind, { icon: typeof FileText; color: string; label: string }> = {
  docx: { icon: FileText, color: "#2b579a", label: "Word" },
  pdf: { icon: FileText, color: "#d93025", label: "PDF" },
  pptx: { icon: Presentation, color: "#d24726", label: "PowerPoint" },
  other: { icon: FileIcon, color: "#64748b", label: "File" },
};

export function FileCards({ projectId, files, me }: { projectId: string; files: FileSummary[]; me: { id: string; admin: boolean } }) {
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { act } = useAct();
  const [busy, setBusy] = useState<{ id: string; action: "edit" | "toPdf" | "toWord"; label: string } | null>(null);
  const [preview, setPreview] = useState<FileSummary | null>(null);

  /** Reads the stored file in the browser (only now, never on upload). */
  async function read(f: FileSummary) {
    const { fetchStoredFile, bytesToContent } = await import("./import-file");
    const kind = fileKind(f.fileName);
    if (kind === "other") throw new Error("This file cannot be read here.");
    return bytesToContent(await fetchStoredFile(f.id), kind);
  }

  async function editInEditor(f: FileSummary) {
    const ok = await confirm({
      title: "Edit in editor?",
      message: "This will convert your Word document to an editable document. The original Word file will be kept. Continue?",
      confirmLabel: "Continue",
    });
    if (!ok) return;
    setBusy({ id: f.id, action: "edit", label: "Converting…" });
    try {
      const { titleFromFile } = await import("./import-file");
      const content = await read(f);
      const r = await createDocumentAction(projectId, { title: titleFromFile(f.fileName), content, sourceFileId: f.id });
      if (!r.ok) throw new Error(r.error);
      toast.success("Editable document made: the Word file is still in Files");
      router.push(`/eru/documents/${r.data.id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The document could not be converted.");
    } finally {
      setBusy(null);
    }
  }

  async function convert(f: FileSummary, to: "pdf" | "docx") {
    setBusy({ id: f.id, action: to === "pdf" ? "toPdf" : "toWord", label: to === "pdf" ? "Converting to PDF…" : "Converting to Word…" });
    try {
      const content = await read(f);
      await act(() => convertFileAction(f.id, to, content));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The file could not be converted.");
    } finally {
      setBusy(null);
    }
  }

  if (!files.length) return <p className="px-5 py-6 text-center text-sm eru-muted">Word, PDF, PowerPoint, data, spreadsheets and any other files for this project. They are kept exactly as uploaded.</p>;
  return (
    <>
      <ul className="grid gap-3 p-4 sm:grid-cols-2" data-testid="eru-file-cards">
        {files.map((f) => {
          const kind = fileKind(f.fileName);
          const { icon: I, color, label } = ICON[kind];
          const actions = fileActions(f.fileName);
          const busyLabel = (action: "edit" | "toPdf" | "toWord", idle: string) => (busy?.id === f.id && busy.action === action ? busy.label : idle);
          return (
            <li key={f.id} className="eru-card flex flex-col gap-3 p-4" data-testid="eru-file-card" data-file-name={f.fileName}>
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg" style={{ background: `${color}14`, color }} title={label} aria-hidden>
                  <I size={22} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink" title={f.fileName}>
                    {f.fileName}
                  </p>
                  <p className="text-xs eru-muted">
                    {label} · {formatBytes(f.size)} · {formatDateTime(f.createdAt)}
                  </p>
                  <p className="text-xs eru-muted">Uploaded by {f.uploadedBy}</p>
                </div>
                {(me.admin || f.uploadedById === me.id) && (
                  <button
                    type="button"
                    className="eru-tool"
                    aria-label={`Remove ${f.fileName}`}
                    onClick={async () => {
                      if (await confirm({ title: `Remove ${f.fileName}?`, message: "The file is deleted for good. Documents made from it keep their own text.", confirmLabel: "Remove", danger: true }))
                        await act(() => removeProjectFileAction(f.id));
                    }}
                  >
                    <Trash2 size={13} aria-hidden />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                <a href={fileHref(f.id)} className="btn btn-ghost btn-sm" download>
                  <Download size={13} aria-hidden /> Download
                </a>
                {actions.includes("preview") && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => setPreview(f)}>
                    <Eye size={13} aria-hidden /> Preview
                  </button>
                )}
                {actions.includes("edit") && (
                  <button type="button" className="btn eru-btn-navy btn-sm" disabled={!!busy} onClick={() => editInEditor(f)}>
                    <Pencil size={13} aria-hidden /> {busyLabel("edit", "Edit in editor")}
                  </button>
                )}
                {actions.includes("toPdf") && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => convert(f, "pdf")}>
                    <RefreshCw size={13} aria-hidden /> {busyLabel("toPdf", "Convert to PDF")}
                  </button>
                )}
                {actions.includes("toWord") && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => convert(f, "docx")}>
                    <RefreshCw size={13} aria-hidden /> {busyLabel("toWord", "Convert to Word")}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {preview && <PreviewDialog file={preview} onClose={() => setPreview(null)} />}
    </>
  );
}

// ── Preview ───────────────────────────────────────────────────────────────

type Loaded = { kind: "pdf"; data: Uint8Array } | { kind: "docx"; html: string } | { kind: "pptx"; slides: Slide[] };

function PreviewDialog({ file, onClose }: { file: FileSummary; onClose: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      const { fetchStoredFile, docxPreviewHtml } = await import("./import-file");
      const bytes = await fetchStoredFile(file.id);
      const kind = fileKind(file.fileName);
      if (kind === "pdf") return { kind, data: bytes } as const;
      if (kind === "docx") return { kind, html: await docxPreviewHtml(bytes) } as const;
      const { readPptx } = await import("@/lib/eru/convert");
      return { kind: "pptx", slides: await readPptx(bytes) } as const;
    })().then(
      (l) => live && setLoaded(l),
      (e) => live && setError(e instanceof Error ? e.message : "This file could not be previewed."),
    );
    return () => {
      live = false;
    };
  }, [file]);
  return (
    <Modal title={`Preview · ${file.fileName}`} onClose={onClose}>
      <div data-testid="eru-preview">
        {error ? (
          <p className="text-sm text-[var(--eru-red)]">
            {error}{" "}
            <a href={fileHref(file.id)} className="font-semibold underline" download>
              Download it
            </a>
          </p>
        ) : !loaded ? (
          <p className="text-sm eru-muted">Opening…</p>
        ) : loaded.kind === "pdf" ? (
          <PdfPreview data={loaded.data} />
        ) : loaded.kind === "docx" ? (
          // Sanitized in docxPreviewHtml: only text-formatting tags, safe links.
          <div className="eru-prose max-h-[65vh] overflow-y-auto rounded-lg border border-[var(--eru-line)] bg-white p-5" data-testid="eru-preview-docx" dangerouslySetInnerHTML={{ __html: loaded.html }} />
        ) : (
          <SlidesPreview slides={loaded.slides} />
        )}
        <p className="mt-3 text-xs eru-muted">Read only. The file itself is unchanged.</p>
      </div>
    </Modal>
  );
}

function Pager({ n, total, set, what }: { n: number; total: number; set: (n: number) => void; what: string }) {
  return (
    <div className="mb-3 flex items-center justify-center gap-3 text-sm">
      <button type="button" className="btn btn-ghost btn-sm" disabled={n <= 1} onClick={() => set(n - 1)} aria-label={`Previous ${what}`}>
        <ChevronLeft size={15} />
      </button>
      <span className="font-semibold tabular-nums" data-testid="eru-preview-page">
        {what === "slide" ? "Slide" : "Page"} {n} of {total}
      </span>
      <button type="button" className="btn btn-ghost btn-sm" disabled={n >= total} onClick={() => set(n + 1)} aria-label={`Next ${what}`}>
        <ChevronRight size={15} />
      </button>
    </div>
  );
}

/** A PDF drawn page by page with pdf.js (works the same on phones, where a PDF in a frame often shows only its first page). */
function PdfPreview({ data }: { data: Uint8Array }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<{ pdf: Awaited<ReturnType<typeof import("@/lib/eru/convert").openPdf>>["pdf"]; destroy: () => Promise<void> } | null>(null);
  const [n, setN] = useState(1);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let opened: { destroy: () => Promise<void> } | null = null;
    import("@/lib/eru/convert")
      .then(({ openPdf }) => openPdf(data.slice()))
      .then((d) => {
        opened = d;
        if (live) setDoc(d);
        else void d.destroy();
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : "This PDF could not be opened."));
    return () => {
      live = false;
      void opened?.destroy();
    };
  }, [data]);
  useEffect(() => {
    if (!doc || !canvas.current) return;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    let live = true;
    void doc.pdf.getPage(n).then((page) => {
      if (!live || !canvas.current) return;
      const el = canvas.current;
      const width = Math.min(el.parentElement?.clientWidth ?? 600, 900);
      const base = page.getViewport({ scale: 1 });
      const ratio = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: (width / base.width) * ratio });
      el.width = viewport.width;
      el.height = viewport.height;
      el.style.width = `${viewport.width / ratio}px`;
      el.style.height = `${viewport.height / ratio}px`;
      task = page.render({ canvas: el, viewport });
      task.promise.catch(() => {});
    });
    return () => {
      live = false;
      task?.cancel();
    };
  }, [doc, n]);
  if (error) return <p className="text-sm text-[var(--eru-red)]">{error}</p>;
  return (
    <div>
      {doc && <Pager n={n} total={doc.pdf.numPages} set={setN} what="page" />}
      <div className="max-h-[65vh] overflow-auto rounded-lg border border-[var(--eru-line)] bg-[#525659] p-2">
        <canvas ref={canvas} className="mx-auto block bg-white" data-testid="eru-preview-pdf" />
      </div>
    </div>
  );
}

function SlideText({ paras }: { paras: SlidePara[] }) {
  return (
    <>
      {paras.map((p, i) => {
        const runs = p.runs.map((r, j) =>
          "br" in r ? (
            <br key={j} />
          ) : (
            <span key={j} className={`${r.bold ? "font-bold" : ""} ${r.italic ? "italic" : ""} ${r.underline ? "underline" : ""}`}>
              {r.text}
            </span>
          ),
        );
        if (!p.runs.length) return null;
        const bullet = p.bullet === "bullet" || p.bullet === "number" || (p.bullet === "auto" && p.level > 0);
        return (
          <p key={i} className="leading-snug" style={{ marginLeft: p.level * 18 }}>
            {bullet && <span aria-hidden>{p.bullet === "number" ? `${i + 1}. ` : "• "}</span>}
            {runs}
          </p>
        );
      })}
    </>
  );
}

/** A presentation one slide at a time: its title, subtitle, text and tables (pictures and layout are not shown). */
function SlidesPreview({ slides }: { slides: Slide[] }) {
  const [n, setN] = useState(1);
  const slide = slides[n - 1];
  return (
    <div>
      <Pager n={n} total={slides.length} set={setN} what="slide" />
      <div className="mx-auto flex aspect-video w-full flex-col gap-2 overflow-auto rounded-lg border border-[var(--eru-line)] bg-white p-6 text-[0.95rem] text-ink shadow-sm" data-testid="eru-preview-slide">
        {slide.shapes.map((s, i) =>
          s.kind === "table" ? (
            <table key={i} className="w-full border-collapse text-sm">
              <tbody>
                {s.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((c, k) => (
                      <td key={k} colSpan={c.colspan} rowSpan={c.rowspan} className={`border border-slate-300 px-2 py-1 ${s.header && r === 0 ? "bg-slate-100 font-semibold" : ""}`}>
                        <SlideText paras={c.paras} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div key={i} className={s.kind === "title" ? "text-2xl font-bold text-[var(--eru-navy)]" : s.kind === "subtitle" ? "text-lg text-slate-600" : ""}>
              <SlideText paras={s.paras} />
            </div>
          ),
        )}
      </div>
      <p className="mt-2 text-xs eru-muted">Slide text and tables are shown; pictures, charts and the slide design are not. Download the file to see it exactly.</p>
    </div>
  );
}
