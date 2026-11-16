import { AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel, LevelFormat, Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType, type IRunOptions, type ParagraphChild } from "docx";
import type { Mark, Node as PMNode } from "@tiptap/pm/model";
import { eruSchema } from "./editor/extensions";
import { decidedDoc } from "./editor/track-changes";

/**
 * A document as a Word file (.docx). Pending tracked changes are shown as if accepted (insertions in, deletions out) and comments are left
 * out, so the file reads as the current text. Formatting carried over: headings 1-3, bold, italic, underline, strike-through, text colour,
 * highlight (as shading), font and size, alignment, bullet and numbered lists (nested), quotes, code, links, line breaks, dividers and tables
 * (merged cells, header rows repeated on each page, column widths set in the editor).
 */

const NUMBERED = "eru-numbered";
const BULLET_INDENT = 360;

/** "#rgb", "#rrggbb" or "rgb(r, g, b)" as RRGGBB; anything else undefined. */
export function hexColor(c: unknown): string | undefined {
  if (typeof c !== "string") return undefined;
  const s = c.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return m[1].split("").map((x) => x + x).join("").toUpperCase();
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return m[1].toUpperCase();
  m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i.exec(s);
  if (m) return m.slice(1, 4).map((x) => Math.min(255, Number(x)).toString(16).padStart(2, "0")).join("").toUpperCase();
  return undefined;
}

/** A CSS size ("16px", "12pt") in Word's half-points. */
export function halfPoints(size: unknown): number | undefined {
  if (typeof size !== "string") return undefined;
  const m = /^(\d+(?:\.\d+)?)(px|pt)$/.exec(size.trim());
  if (!m) return undefined;
  const pt = m[2] === "pt" ? Number(m[1]) : Number(m[1]) * 0.75;
  return pt > 0 && pt < 400 ? Math.round(pt * 2) : undefined;
}

/** The first font of a CSS font-family list, without quotes. */
const firstFont = (f: unknown) => (typeof f === "string" ? f.split(",")[0].trim().replace(/^["']|["']$/g, "") || undefined : undefined);

function runOptions(text: string, marks: readonly Mark[], extra: Partial<IRunOptions> = {}): IRunOptions {
  const o: { -readonly [K in keyof IRunOptions]?: IRunOptions[K] } = { text, ...extra };
  for (const m of marks) {
    switch (m.type.name) {
      case "bold":
        o.bold = true;
        break;
      case "italic":
        o.italics = true;
        break;
      case "underline":
        o.underline = {};
        break;
      case "strike":
        o.strike = true;
        break;
      case "code":
        o.font = "Courier New";
        break;
      case "highlight": {
        const fill = hexColor(m.attrs.color) ?? "FFF59D";
        o.shading = { type: ShadingType.CLEAR, color: "auto", fill };
        break;
      }
      case "textStyle": {
        const color = hexColor(m.attrs.color);
        if (color) o.color = color;
        const font = firstFont(m.attrs.fontFamily);
        if (font) o.font = font;
        const size = halfPoints(m.attrs.fontSize);
        if (size) o.size = size;
        break;
      }
    }
  }
  return o as IRunOptions;
}

/** A text block's inline content as runs and links. */
function inline(node: PMNode, extra: Partial<IRunOptions> = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  node.forEach((child) => {
    if (child.type.name === "hardBreak") {
      out.push(new TextRun({ break: 1, ...extra }));
      return;
    }
    if (!child.isText) return;
    const link = child.marks.find((m) => m.type.name === "link");
    const run = new TextRun(runOptions(child.text ?? "", child.marks, extra));
    const href = typeof link?.attrs.href === "string" && /^(https?:|mailto:)/i.test(link.attrs.href) ? link.attrs.href : null;
    out.push(href ? new ExternalHyperlink({ link: href, children: [new TextRun({ ...runOptions(child.text ?? "", child.marks, extra), style: "Hyperlink" })] }) : run);
  });
  return out;
}

const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED };
const HEADING = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];

type Ctx = { list?: { kind: "bullet" | "ordered"; level: number; instance: number }; quote?: boolean; header?: boolean; nextInstance: () => number };

/** A column width set in the editor (CSS pixels) in twips; one pixel is 15 twips. */
const PX_TWIPS = 15;

/**
 * A table: its cells' content as blocks (lists, quotes and tables inside cells come across), merged cells, header cells bold and shaded,
 * the header rows at the top repeated on each page. Column widths come across when every column has one; otherwise the table is page wide
 * with equal columns.
 */
function table(node: PMNode, ctx: Ctx): Table {
  const rows: TableRow[] = [];
  let headerRun = true;
  node.forEach((row) => {
    const cells: TableCell[] = [];
    let allHeader = row.childCount > 0;
    row.forEach((cell) => {
      const header = cell.type.name === "tableHeader";
      if (!header) allHeader = false;
      const content = blocks(cell, { nextInstance: ctx.nextInstance, header });
      cells.push(
        new TableCell({
          children: content.length ? content : [new Paragraph({ children: [] })],
          columnSpan: Number(cell.attrs.colspan) > 1 ? Number(cell.attrs.colspan) : undefined,
          rowSpan: Number(cell.attrs.rowspan) > 1 ? Number(cell.attrs.rowspan) : undefined,
          shading: header ? { type: ShadingType.CLEAR, color: "auto", fill: "F1F5F9" } : undefined,
        }),
      );
    });
    headerRun &&= allHeader;
    if (cells.length) rows.push(new TableRow({ children: cells, tableHeader: headerRun || undefined }));
  });
  // Column widths, from the first row (a cell spanning columns carries one width per column).
  const widths: (number | null)[] = [];
  node.firstChild?.forEach((cell) => {
    const span = Math.max(1, Number(cell.attrs.colspan) || 1);
    const w = Array.isArray(cell.attrs.colwidth) ? (cell.attrs.colwidth as unknown[]) : [];
    for (let i = 0; i < span; i++) widths.push(typeof w[i] === "number" && (w[i] as number) > 0 ? (w[i] as number) : null);
  });
  const sized = widths.length > 0 && widths.every((w) => w !== null);
  return new Table({
    rows,
    width: sized ? { size: (widths as number[]).reduce((a, b) => a + b, 0) * PX_TWIPS, type: WidthType.DXA } : { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: sized ? (widths as number[]).map((w) => Math.round(w * PX_TWIPS)) : undefined,
  });
}

function blocks(node: PMNode, ctx: Ctx): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  node.forEach((child) => {
    const t = child.type.name;
    const listProps = ctx.list
      ? ctx.list.kind === "bullet"
        ? { bullet: { level: ctx.list.level } }
        : { numbering: { reference: NUMBERED, level: ctx.list.level, instance: ctx.list.instance } }
      : {};
    const quoteProps = ctx.quote ? { indent: { left: 720 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: "CBD5E1", space: 8 } } } : {};
    if (t === "paragraph") {
      const extra = { ...(ctx.quote ? { italics: true } : {}), ...(ctx.header ? { bold: true } : {}) };
      out.push(new Paragraph({ children: inline(child, extra), alignment: ALIGN[child.attrs.textAlign as string], ...listProps, ...quoteProps }));
    } else if (t === "heading") {
      out.push(new Paragraph({ children: inline(child), heading: HEADING[Math.min(3, Math.max(1, Number(child.attrs.level) || 1))], alignment: ALIGN[child.attrs.textAlign as string] }));
    } else if (t === "bulletList" || t === "orderedList") {
      const level = ctx.list ? Math.min(8, ctx.list.level + 1) : 0;
      const kind = t === "bulletList" ? "bullet" : "ordered";
      const instance = kind === "ordered" ? ctx.nextInstance() : 0;
      child.forEach((item) => out.push(...blocks(item, { ...ctx, list: { kind, level, instance } })));
    } else if (t === "listItem") {
      out.push(...blocks(child, ctx));
    } else if (t === "blockquote") {
      out.push(...blocks(child, { ...ctx, quote: true }));
    } else if (t === "codeBlock") {
      const lines = (child.textContent || "").split("\n");
      out.push(
        new Paragraph({
          shading: { type: ShadingType.CLEAR, color: "auto", fill: "F1F5F9" },
          children: lines.map((line, i) => new TextRun({ text: line, font: "Courier New", size: 20, break: i ? 1 : undefined })),
        }),
      );
    } else if (t === "table") {
      out.push(table(child, ctx));
    } else if (t === "horizontalRule") {
      out.push(new Paragraph({ thematicBreak: true, children: [] }));
    } else if (child.isBlock) {
      out.push(...blocks(child, ctx));
    }
  });
  return out;
}

/** The .docx file for a document's stored content. */
export async function exportDocx(title: string, content: unknown): Promise<Buffer> {
  const schema = eruSchema();
  const { doc } = decidedDoc(schema.nodeFromJSON(content), null, "accept");
  let instance = 0;
  const body = blocks(doc, { nextInstance: () => ++instance });
  const file = new Document({
    creator: "MCCIA App Hub · ERU",
    title,
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    numbering: {
      config: [
        {
          reference: NUMBERED,
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3],
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: BULLET_INDENT * (level + 2), hanging: BULLET_INDENT } } },
          })),
        },
      ],
    },
    sections: [{ children: body.length ? body : [new Paragraph({ children: [] })] }],
  });
  return Packer.toBuffer(file);
}

/** A safe file name for the download: the title, then .docx. */
export const docxFileName = (title: string) => `${title.replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 100) || "document"}.docx`;
