"use client";

import { generateJSON } from "@tiptap/core";
import { eruExtensions, plainContent } from "@/lib/eru/editor/extensions";
import type { ImportKind } from "@/lib/eru/file-types";
import { pdfToDoc, readPdf, readPptx, slidesToDoc } from "@/lib/eru/convert";
import { fileHref } from "../ui";

/**
 * Reading a stored file in the browser, only when someone asks (Edit in editor, Convert, Preview): files are stored as they were uploaded.
 *   - .docx: mammoth turns it into HTML (headings, bold, italic, underline, strike-through, lists, links, tables), then the editor reads that.
 *     Images are left out (the Word file itself is always kept).
 *   - .pdf and .pptx: their text and basic structure (see convert.ts).
 */

/** The stored file's bytes: the file link redirects to a short-lived link to storage, which the browser fetches directly. */
export async function fetchStoredFile(fileId: string): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(fileHref(fileId), { credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new Error("The file could not be fetched. Check your connection and try again.");
  }
  if (!res.ok) throw new Error(res.status === 404 ? "That file is no longer in storage." : `The file could not be fetched (${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

const MAMMOTH_STYLES = ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh", "p[style-name='Quote'] => blockquote > p:fresh", "u => u"];

async function docxHtml(bytes: Uint8Array): Promise<string> {
  const mammoth = await import("mammoth");
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const result = await mammoth.convertToHtml({ arrayBuffer: buf }, { convertImage: mammoth.images.imgElement(async () => ({ src: "" })), styleMap: MAMMOTH_STYLES });
  return result.value.replace(/<img[^>]*>/g, "");
}

/** A file's content as an editable document (editor JSON). */
export async function bytesToContent(bytes: Uint8Array, kind: ImportKind): Promise<Record<string, unknown>> {
  if (kind === "pdf") return pdfToDoc(await readPdf(bytes));
  if (kind === "pptx") return slidesToDoc(await readPptx(bytes));
  return plainContent(generateJSON((await docxHtml(bytes)) || "<p></p>", eruExtensions()));
}

const KEEP = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "STRONG", "B", "EM", "I", "U", "S", "DEL", "SUP", "SUB", "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH", "A", "BR", "BLOCKQUOTE", "PRE", "CODE"]);

/**
 * A Word file as read-only HTML for the preview, made safe to show: only text-formatting tags are kept (anything else is reduced to its text),
 * every attribute is dropped except a link's web or mail address and a table cell's span. A link opens in a new tab.
 */
export async function docxPreviewHtml(bytes: Uint8Array): Promise<string> {
  const doc = new DOMParser().parseFromString(`<body>${await docxHtml(bytes)}</body>`, "text/html");
  const clean = (el: Element) => {
    for (const child of [...el.children]) {
      clean(child);
      if (!KEEP.has(child.tagName)) {
        child.replaceWith(...child.childNodes);
        continue;
      }
      for (const a of [...child.attributes]) {
        const keep = (child.tagName === "A" && a.name === "href" && /^(https?:|mailto:)/i.test(a.value)) || ((child.tagName === "TD" || child.tagName === "TH") && (a.name === "colspan" || a.name === "rowspan") && /^\d{1,2}$/.test(a.value));
        if (!keep) child.removeAttribute(a.name);
      }
      if (child.tagName === "A") {
        child.setAttribute("target", "_blank");
        child.setAttribute("rel", "noopener noreferrer");
      }
    }
  };
  clean(doc.body);
  return doc.body.innerHTML || "<p><em>This document has no text.</em></p>";
}

/** The title to give a document made from a file: the file name without its extension. */
export const titleFromFile = (name: string) => name.replace(/\.(docx|pdf|pptx)$/i, "").replace(/[_]+/g, " ").trim().slice(0, 200) || "Imported document";
