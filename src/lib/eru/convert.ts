/**
 * PDF and PowerPoint (.pptx) files as editable documents (editor JSON). Text and its basic structure come across: from a PDF, headings (by
 * font size), paragraphs and bullet / numbered lists; from a .pptx, one section per slide (the slide's title as a heading, then its text,
 * bullets with their levels, bold / italic / underline, and tables). Pictures, charts, layout, colours and fonts do not: the page says so,
 * and the original file is kept with the document.
 *
 * No DOM: the same code runs in the browser (Edit in editor, Convert, Preview) and in the unit tests. The file readers load pdf.js / JSZip
 * only when called. Nothing is converted on upload: files are stored as they are, and converted only when someone asks.
 */

type Json = Record<string, unknown>;
type Mark = { type: "bold" | "italic" | "underline" };
type Inline = { type: "text"; text: string; marks?: Mark[] } | { type: "hardBreak" };

/** Shown on a document converted from a PDF or a .pptx. */
export const CONVERTED_WARNING = "Some formatting may not be preserved during conversion.";

/** Thrown when a file has nothing to convert, or cannot be read; the message is for the person importing it. */
export class ConvertError extends Error {}

/** Text as it may go into a document: control characters out, runs of spaces kept as they are. */
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F￾￿]/g, " ");

const text = (t: string, marks?: Mark[]): Inline => (marks?.length ? { type: "text", text: t, marks } : { type: "text", text: t });
const paragraph = (content: Inline[]): Json => (content.length ? { type: "paragraph", content } : { type: "paragraph" });
const heading = (level: 1 | 2 | 3, t: string): Json => ({ type: "heading", attrs: { level }, content: [text(t)] });

// ── PDF ────────────────────────────────────────────────────────────────────

/** One piece of text on a PDF page, as pdf.js reports it: where it starts (x, y from the bottom), its width, its font size, end of line. */
export type PdfItem = { str: string; x: number; y: number; width: number; size: number; eol: boolean };

type Line = { text: string; size: number; y: number; x: number; end: number };

/** A page's text pieces as lines (top to bottom, as pdf.js gives them). */
function pdfLines(items: readonly PdfItem[]): Line[] {
  const lines: Line[] = [];
  let cur: Line | null = null;
  const push = () => {
    if (cur && cur.text.trim()) lines.push({ ...cur, text: cur.text.replace(/\s+/g, " ").trim() });
    cur = null;
  };
  for (const it of items) {
    const str = clean(it.str);
    if (cur && Math.abs(it.y - cur.y) > Math.max(cur.size || it.size, it.size, 1) * 0.5) push();
    if (!cur) cur = { text: "", size: 0, y: it.y, x: it.x, end: it.x };
    // A visible gap between two pieces on one line is a space (pdf.js does not always report one).
    if (cur.text && !/\s$/.test(cur.text) && !/^\s/.test(str) && it.x - cur.end > Math.max(it.size, 1) * 0.15) cur.text += " ";
    cur.text += str;
    if (str.trim()) cur.size = Math.max(cur.size, it.size);
    cur.end = Math.max(cur.end, it.x + it.width);
    if (it.eol) push();
  }
  push();
  return lines;
}

const BULLET = /^[•●○◦▪▫■□‣⁃∙·❖➢➤►▶✓✔\-–—*]\s+(.+)$/;
const NUMBERED = /^\(?\d{1,3}[.)]\s+(.+)$/;
const PAGE_NUMBER = /^(?:page\s+)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$/i;

type PdfBlock = { kind: "p" | "h" | "bullet" | "number"; level: 0 | 1 | 2 | 3; text: string; size: number; y: number; page: number; end: number };

/** The most common font size, weighted by how much text uses it: the body text's size. */
function bodySize(lines: readonly Line[]): number {
  const weight = new Map<number, number>();
  for (const l of lines) {
    const k = Math.round(l.size * 2) / 2;
    weight.set(k, (weight.get(k) ?? 0) + l.text.length);
  }
  let best = 0;
  let size = 0;
  for (const [k, w] of weight) if (w > best || (w === best && k < size)) [best, size] = [w, k];
  return size || 1;
}

/** A line's text joined onto the paragraph so far: a word broken with a hyphen at the end of a line is joined back up. */
function join(a: string, b: string): string {
  if (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b;
  return `${a} ${b}`;
}

/**
 * A PDF's pages (each a list of text pieces) as a document: headings where the text is clearly larger than the body text (three levels),
 * paragraphs from lines that run on (a wider gap, a change of size, or a short line ending a sentence starts a new one), bullet and
 * numbered lists from lines that start with a bullet or a number, page numbers left out.
 */
export function pdfToDoc(pages: readonly (readonly PdfItem[])[]): Json {
  const byPage = pages.map(pdfLines);
  const all = byPage.flat();
  if (!all.some((l) => /\S/.test(l.text))) throw new ConvertError("This PDF has no text to convert (it may be scanned pages, which are pictures). It is still kept as it is: download or preview it.");
  const body = bodySize(all);
  const levelOf = (l: Line): 0 | 1 | 2 | 3 => {
    if (l.text.length > 160) return 0;
    const r = l.size / body;
    return r >= 1.5 ? 1 : r >= 1.25 ? 2 : r >= 1.1 ? 3 : 0;
  };
  const blocks: PdfBlock[] = [];
  byPage.forEach((lines, page) => {
    const right = Math.max(...lines.map((l) => l.end));
    for (const l of lines) {
      if (PAGE_NUMBER.test(l.text)) continue;
      const level = levelOf(l);
      const bullet = !level && BULLET.exec(l.text);
      const numbered = !level && !bullet && NUMBERED.exec(l.text);
      const prev = blocks[blocks.length - 1];
      const gap = prev && prev.page === page ? prev.y - l.y : Infinity;
      const near = (factor: number) => gap > 0 && gap <= Math.max(l.size, prev.size) * factor;
      const sameSize = prev && Math.abs(prev.size - l.size) <= Math.max(0.6, body * 0.06);
      if (prev && !bullet && !numbered && sameSize) {
        const endedEarly = prev.end < right * 0.8 && /[.:!?]["')\]]?$/.test(prev.text);
        // A heading that runs onto a second line; a paragraph (or a list item) that continues.
        if ((prev.kind === "h" && level === prev.level && near(1.6)) || (prev.kind !== "h" && !level && near(1.45) && !endedEarly)) {
          prev.text = join(prev.text, l.text);
          prev.y = l.y;
          prev.end = l.end;
          continue;
        }
      }
      if (bullet) blocks.push({ kind: "bullet", level: 0, text: bullet[1], size: l.size, y: l.y, page, end: l.end });
      else if (numbered) blocks.push({ kind: "number", level: 0, text: numbered[1], size: l.size, y: l.y, page, end: l.end });
      else blocks.push({ kind: level ? "h" : "p", level, text: l.text, size: l.size, y: l.y, page, end: l.end });
    }
  });
  const content: Json[] = [];
  for (const b of blocks) {
    if (b.kind === "h") content.push(heading(b.level as 1 | 2 | 3, b.text));
    else if (b.kind === "p") content.push(paragraph([text(b.text)]));
    else {
      const type = b.kind === "bullet" ? "bulletList" : "orderedList";
      const last = content[content.length - 1] as { type: string; content: Json[] } | undefined;
      const item = { type: "listItem", content: [paragraph([text(b.text)])] };
      if (last?.type === type) last.content.push(item);
      else content.push({ type, content: [item] });
    }
  }
  return { type: "doc", content: content.length ? content : [paragraph([])] };
}

/** pdf.js, loaded once, and running in this thread (no separate worker script to serve, nothing for the page's security policy to allow). */
async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const g = globalThis as { pdfjsWorker?: unknown };
  g.pdfjsWorker ??= await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  return pdfjs;
}

/** A PDF opened for drawing its pages (the preview). Call destroy() when done. */
export async function openPdf(data: Uint8Array) {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data, verbosity: 0 });
  try {
    const pdf = await task.promise;
    return { pdf, destroy: () => task.destroy() };
  } catch (e) {
    await task.destroy();
    if ((e as { name?: string })?.name === "PasswordException") throw new ConvertError("This PDF is password-protected, so it cannot be previewed here. Download it instead.");
    throw new ConvertError("This PDF could not be opened for preview. Download it instead.");
  }
}

/** A PDF file's text, page by page, as pdf.js reads it. */
export async function readPdf(data: Uint8Array): Promise<PdfItem[][]> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({ data, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (e) {
    const name = (e as { name?: string })?.name;
    await task.destroy();
    if (name === "PasswordException") throw new ConvertError("This PDF is password-protected. Remove the password, then upload it again.");
    throw new ConvertError("This PDF could not be read. It may be damaged or password-protected; try saving it again.");
  }
  try {
    const pages: PdfItem[][] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const tc = await page.getTextContent();
      const items: PdfItem[] = [];
      for (const it of tc.items) {
        if (!("str" in it)) continue;
        const [, b, , d, x, y] = it.transform as number[];
        items.push({ str: it.str, x, y, width: it.width, size: Math.hypot(b, d) || it.height || 0, eol: it.hasEOL });
      }
      pages.push(items);
      page.cleanup();
    }
    return pages;
  } finally {
    await task.destroy();
  }
}

// ── PowerPoint (.pptx) ─────────────────────────────────────────────────────

type Run = { text: string; bold?: boolean; italic?: boolean; underline?: boolean } | { br: true };
/** One paragraph of a slide's text: its runs, its outline level (0 at the top) and its bullet (auto: whatever the shape gives it). */
export type SlidePara = { runs: Run[]; level: number; bullet: "none" | "bullet" | "number" | "auto" };
type Cell = { paras: SlidePara[]; colspan: number; rowspan: number };
export type SlideShape = { kind: "title" | "subtitle" | "body" | "text"; paras: SlidePara[] } | { kind: "table"; header: boolean; rows: Cell[][] };
export type Slide = { shapes: SlideShape[] };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] !== "#") return ENTITIES[e.toLowerCase()];
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });

const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** The paragraphs of a text body (<a:p> elements). */
function paragraphs(xml: string): SlidePara[] {
  const out: SlidePara[] = [];
  for (const p of xml.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g)) {
    const inner = p[1];
    const pPr = /<a:pPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:pPr>)/.exec(inner)?.[0] ?? "";
    const level = Math.min(8, Number(attr(pPr.split(">")[0], "lvl") ?? 0) || 0);
    const bullet = /<a:buNone\b/.test(pPr) ? "none" : /<a:buAutoNum\b/.test(pPr) ? "number" : /<a:buChar\b|<a:buBlip\b/.test(pPr) ? "bullet" : "auto";
    const runs: Run[] = [];
    for (const r of inner.matchAll(/<a:r>([\s\S]*?)<\/a:r>|<a:br\b[^>]*\/>|<a:br\b[^>]*>[\s\S]*?<\/a:br>/g)) {
      if (r[0].startsWith("<a:br")) {
        runs.push({ br: true });
        continue;
      }
      const t = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/.exec(r[1]);
      if (!t) continue;
      const rPr = /<a:rPr\b[^>]*>/.exec(r[1])?.[0] ?? "";
      const u = attr(rPr, "u");
      runs.push({ text: clean(decode(t[1])), bold: attr(rPr, "b") === "1" || undefined, italic: attr(rPr, "i") === "1" || undefined, underline: (!!u && u !== "none") || undefined });
    }
    out.push({ runs, level, bullet });
  }
  return out;
}

/** One slide's shapes, in the order they are drawn (text boxes, placeholders, tables; pictures and charts are left out). */
export function parseSlideXml(xml: string): Slide {
  const shapes: SlideShape[] = [];
  for (const m of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>|<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g)) {
    const s = m[0];
    if (s.startsWith("<p:graphicFrame")) {
      const tbl = /<a:tbl>([\s\S]*?)<\/a:tbl>/.exec(s);
      if (!tbl) continue;
      const rows: Cell[][] = [];
      for (const tr of tbl[1].matchAll(/<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/g)) {
        const cells: Cell[] = [];
        for (const tc of tr[1].matchAll(/<a:tc\b([^>]*)>([\s\S]*?)<\/a:tc>|<a:tc\b([^>]*)\/>/g)) {
          const a = tc[1] ?? tc[3] ?? "";
          if (attr(a, "hMerge") === "1" || attr(a, "vMerge") === "1") continue; // covered by a merged cell
          cells.push({ paras: paragraphs(tc[2] ?? ""), colspan: Math.max(1, Number(attr(a, "gridSpan")) || 1), rowspan: Math.max(1, Number(attr(a, "rowSpan")) || 1) });
        }
        if (cells.length) rows.push(cells);
      }
      const tblPr = /<a:tblPr\b[^>]*>/.exec(tbl[1])?.[0] ?? "";
      if (rows.length) shapes.push({ kind: "table", header: attr(tblPr, "firstRow") === "1", rows });
      continue;
    }
    const ph = /<p:ph\b[^>]*>/.exec(s)?.[0];
    const type = ph ? (attr(ph, "type") ?? "body") : null;
    if (type && ["dt", "ftr", "sldNum", "hdr", "pic", "chart", "media", "clipArt", "sldImg"].includes(type)) continue;
    const kind = type === "title" || type === "ctrTitle" ? "title" : type === "subTitle" ? "subtitle" : type ? "body" : "text";
    const body = /<p:txBody>([\s\S]*?)<\/p:txBody>/.exec(s);
    if (body) shapes.push({ kind, paras: paragraphs(body[1]) });
  }
  return { shapes };
}

/** The slides' file names in the order the deck shows them (presentation.xml's slide list, through its relationships file). */
export function slideOrder(presentationXml: string, relsXml: string): string[] {
  const targets = new Map<string, string>();
  for (const r of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(r[0], "Id");
    const target = attr(r[0], "Target");
    if (id && target && /slides\/slide\d+\.xml$/.test(target)) targets.set(id, `ppt/slides/${target.split("/").pop()}`);
  }
  const out: string[] = [];
  for (const s of presentationXml.matchAll(/<p:sldId\b[^>]*>/g)) {
    const t = targets.get(attr(s[0], "r:id") ?? "");
    if (t) out.push(t);
  }
  return out;
}

/** A paragraph's runs as editor content: text with its bold / italic / underline, line breaks. */
function inlineOf(runs: readonly Run[]): Inline[] {
  const out: Inline[] = [];
  for (const r of runs) {
    if ("br" in r) {
      out.push({ type: "hardBreak" });
      continue;
    }
    if (!r.text) continue;
    const marks: Mark[] = [];
    if (r.bold) marks.push({ type: "bold" });
    if (r.italic) marks.push({ type: "italic" });
    if (r.underline) marks.push({ type: "underline" });
    out.push(text(r.text, marks));
  }
  // Line breaks at either end carry nothing.
  while (out[0]?.type === "hardBreak") out.shift();
  while (out[out.length - 1]?.type === "hardBreak") out.pop();
  return out;
}

const plain = (paras: readonly SlidePara[]) =>
  paras
    .map((p) => p.runs.map((r) => ("br" in r ? " " : r.text)).join(""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

type Item = { level: number; kind: "bullet" | "number"; content: Inline[] };

/** List items (each with a level) as nested lists. */
function nestedList(items: readonly Item[], start: number): [Json, number] {
  const { level, kind } = items[start];
  const lis: { type: "listItem"; content: Json[] }[] = [];
  let i = start;
  while (i < items.length && items[i].level >= level && (items[i].level > level || items[i].kind === kind)) {
    if (items[i].level === level) {
      lis.push({ type: "listItem", content: [paragraph(items[i].content)] });
      i++;
    } else {
      const [sub, next] = nestedList(items, i);
      if (lis.length) lis[lis.length - 1].content.push(sub);
      else lis.push({ type: "listItem", content: [paragraph([]), sub] });
      i = next;
    }
  }
  return [{ type: kind === "number" ? "orderedList" : "bulletList", content: lis }, i];
}

/** A text shape's paragraphs as blocks: plain paragraphs, and bullets as (nested) lists. A body placeholder's paragraphs are bullets unless they say not. */
function textBlocks(paras: readonly SlidePara[], bulletsByDefault: boolean): Json[] {
  const out: Json[] = [];
  let items: Item[] = [];
  const flush = () => {
    for (let i = 0; i < items.length; ) {
      const [list, next] = nestedList(items, i);
      out.push(list);
      i = next;
    }
    items = [];
  };
  for (const p of paras) {
    const content = inlineOf(p.runs);
    if (!content.some((c) => c.type === "text" && c.text.trim())) continue;
    const bullet = p.bullet === "auto" ? (bulletsByDefault ? "bullet" : "none") : p.bullet;
    if (bullet === "none") {
      flush();
      out.push(paragraph(content));
    } else items.push({ level: p.level, kind: bullet, content });
  }
  flush();
  return out;
}

function tableBlock(shape: Extract<SlideShape, { kind: "table" }>): Json {
  return {
    type: "table",
    content: shape.rows.map((row, r) => ({
      type: "tableRow",
      content: row.map((cell) => {
        const blocks = textBlocks(cell.paras, false);
        return { type: shape.header && r === 0 ? "tableHeader" : "tableCell", attrs: { colspan: cell.colspan, rowspan: cell.rowspan }, content: blocks.length ? blocks : [paragraph([])] };
      }),
    })),
  };
}

/** Slides as a document: each slide a section headed by its title (or "Slide n"), then its subtitle, text, bullets and tables. */
export function slidesToDoc(slides: readonly Slide[]): Json {
  const content: Json[] = [];
  let anyText = false;
  slides.forEach((slide, i) => {
    const title = plain(slide.shapes.filter((s) => s.kind === "title").flatMap((s) => (s.kind === "title" ? s.paras : [])));
    content.push(heading(2, title || `Slide ${i + 1}`));
    if (title) anyText = true;
    for (const s of slide.shapes) {
      if (s.kind === "title") continue;
      if (s.kind === "table") {
        content.push(tableBlock(s));
        anyText ||= s.rows.some((r) => r.some((c) => plain(c.paras)));
      } else if (s.kind === "subtitle") {
        const t = plain(s.paras);
        if (t) content.push(heading(3, t));
        anyText ||= !!t;
      } else {
        const blocks = textBlocks(s.paras, s.kind === "body");
        content.push(...blocks);
        anyText ||= blocks.length > 0;
      }
    }
  });
  if (!anyText) throw new ConvertError("This presentation has no text to convert (its slides may be pictures only). It is still kept as it is: download it.");
  return { type: "doc", content };
}

/** A .pptx file's slides, in the deck's order. */
export async function readPptx(data: Uint8Array): Promise<Slide[]> {
  const { default: JSZip } = await import("jszip");
  let zip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new ConvertError("This file could not be opened as a PowerPoint presentation (.pptx). It may be damaged, or an older .ppt file: save it as .pptx and try again.");
  }
  const read = (name: string) => zip.file(name)?.async("string") ?? Promise.resolve(null);
  const [presentation, rels] = await Promise.all([read("ppt/presentation.xml"), read("ppt/_rels/presentation.xml.rels")]);
  if (!presentation) throw new ConvertError("This file is not a PowerPoint presentation (.pptx).");
  let names = rels ? slideOrder(presentation, rels) : [];
  // No usable slide list: the slide files in number order.
  if (!names.length)
    names = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  const slides: Slide[] = [];
  for (const n of names) {
    const xml = await read(n);
    if (xml) slides.push(parseSlideXml(xml));
  }
  if (!slides.length) throw new ConvertError("This presentation has no slides to convert.");
  return slides;
}
