"use client";

import { generateJSON } from "@tiptap/core";
import { eruExtensions, plainContent } from "@/lib/eru/editor/extensions";

/**
 * A .docx file as editor content, in the browser: mammoth turns it into HTML (headings, bold, italic, underline, strike-through, lists,
 * links, tables as plain paragraphs), then the editor reads that HTML. Images are left out (they would make the document too large to save;
 * the original file is kept with the document). Loaded only when someone imports a file.
 */
export async function docxToContent(file: File): Promise<{ content: Record<string, unknown>; warnings: number }> {
  const mammoth = await import("mammoth");
  const result = await mammoth.convertToHtml(
    { arrayBuffer: await file.arrayBuffer() },
    {
      convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
      styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh", "p[style-name='Quote'] => blockquote > p:fresh", "u => u"],
    },
  );
  const html = result.value.replace(/<img[^>]*>/g, "");
  const content = plainContent(generateJSON(html || "<p></p>", eruExtensions()));
  return { content, warnings: result.messages.filter((m) => m.type === "warning").length };
}

/** The title to give an imported document: the file name without .docx. */
export const titleFromFile = (name: string) => name.replace(/\.docx$/i, "").replace(/[_]+/g, " ").trim().slice(0, 200) || "Imported document";
