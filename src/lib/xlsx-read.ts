import { strFromU8, unzipSync } from "fflate";

/**
 * Reads the first sheet of an .xlsx file into a table of text cells. Runs in the administrator's browser, so a hostile file can only
 * affect their own tab, and the server still validates every row it is sent. Only the few XML parts that are needed are unpacked, and
 * anything unreasonably large is refused. Formulas are not evaluated: a cell is read as the value Excel last saved.
 */
const MAX_PART_BYTES = 30_000_000;
const MAX_ROWS = 5000;
const MAX_COLS = 60;

const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k === "amp") return "&";
    if (k === "lt") return "<";
    if (k === "gt") return ">";
    if (k === "quot") return '"';
    if (k === "apos") return "'";
    const code = k.startsWith("#x") ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
  });

const texts = (xml: string) => {
  const noPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  return [...noPhonetic.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join("");
};

const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

/** "AB12" gives column index 27. */
function colIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function xlsxToTable(bytes: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => f.originalSize <= MAX_PART_BYTES && /^xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/sheet\d+\.xml)$/.test(f.name),
    });
  } catch {
    throw new Error("That does not look like a valid Excel (.xlsx) file.");
  }
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : "");

  // Which part holds the first sheet: ask the workbook, fall back to sheet1.
  let sheetPath = "xl/worksheets/sheet1.xml";
  const firstSheet = /<sheet\b[^>]*>/.exec(text("xl/workbook.xml"))?.[0];
  const rid = firstSheet && /\br:id="([^"]*)"/.exec(firstSheet)?.[1];
  if (rid) {
    for (const rel of text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)) {
      if (attr(rel[0], "Id") === rid) {
        const target = attr(rel[0], "Target");
        if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
      }
    }
  }
  const sheet = text(sheetPath);
  if (!sheet) throw new Error("That Excel file has no readable sheet.");

  const shared = [...text("xl/sharedStrings.xml").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));

  const table: string[][] = [];
  for (const r of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNo = Number(attr(r[1], "r")) || table.length + 1;
    if (rowNo > MAX_ROWS) break;
    const cells: string[] = [];
    for (const c of (r[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(c[1], "r") ?? "";
      const col = Math.min(colIndex(ref || "A"), MAX_COLS - 1);
      const type = attr(c[1], "t");
      const inner = c[2] ?? "";
      let value = "";
      if (type === "inlineStr") value = texts(/<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner)?.[1] ?? "");
      else {
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        if (v !== undefined) {
          if (type === "s") value = shared[Number(v)] ?? "";
          else if (type === "b") value = v.trim() === "1" ? "TRUE" : "FALSE";
          else if (type === "e") value = "";
          else value = decode(v);
        }
      }
      while (cells.length <= col) cells.push("");
      cells[col] = value;
    }
    while (table.length < rowNo - 1) table.push([]);
    table[rowNo - 1] = cells;
  }
  return table;
}
