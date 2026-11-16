"use client";

import { generateJSON } from "@tiptap/core";
import { eruExtensions, plainContent } from "@/lib/eru/editor/extensions";
import type { ImportKind } from "@/lib/eru/file-types";
import { pdfToDoc, readPdf, readPptx, slidesToDoc } from "@/lib/eru/convert";

/**
 * A file as editor content, in the browser. Loaded only when someone imports a file.
 *   - .docx: mammoth turns it into HTML (headings, bold, italic, underline, strike-through, lists, links, tables), then the editor reads that
 *     HTML. Images are left out (they would make the document too large to save; the original file is kept with the document).
 *   - .pdf and .pptx: their text and basic structure are converted (see convert.ts); `converted` says so, for the page to warn that some
 *     formatting may not have come across.
 */
export async function fileToContent(file: File, kind: ImportKind): Promise<{ content: Record<string, unknown>; converted: boolean }> {
  if (kind === "pdf") return { content: pdfToDoc(await readPdf(new Uint8Array(await file.arrayBuffer()))), converted: true };
  if (kind === "pptx") return { content: slidesToDoc(await readPptx(new Uint8Array(await file.arrayBuffer()))), converted: true };
  const mammoth = await import("mammoth");
  const result = await mammoth.convertToHtml(
    { arrayBuffer: await file.arrayBuffer() },
    {
      convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
      styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh", "p[style-name='Quote'] => blockquote > p:fresh", "u => u"],
    },
  );
  const html = result.value.replace(/<img[^>]*>/g, "");
  return { content: plainContent(generateJSON(html || "<p></p>", eruExtensions())), converted: false };
}

/** The title to give an imported document: the file name without its extension. */
export const titleFromFile = (name: string) => name.replace(/\.(docx|pdf|pptx)$/i, "").replace(/[_]+/g, " ").trim().slice(0, 200) || "Imported document";
