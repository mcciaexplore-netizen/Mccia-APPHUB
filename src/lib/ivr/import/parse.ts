import "server-only";
import { parseCsv } from "@/lib/csv";
import { xlsxToTable } from "@/lib/xlsx-read";

export const MAX_ROWS = 20_000;
// The file travels in a server action, which the hub caps at 3 MB (next.config.ts); 20,000 rows of a calling list is well under this.
export const MAX_BYTES = 2.5 * 1024 * 1024;

export class ImportError extends Error {}

export type ParsedSheet = { headers: string[]; rows: string[][] };

type FileLike = { name: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };

const EXCEL_EXPONENT = /^\d(?:\.\d+)?e\+\d+$/i;

/** Excel often stores 9876543210 as 9.87654321E+9 or as a float. Turn every cell into a plain string. */
export function cellToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    const iso = v.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 19).replace("T", " ");
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    return Number.isInteger(v) ? v.toFixed(0) : String(v);
  }
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  const s = String(v).replace(/ /g, " ").trim();
  if (EXCEL_EXPONENT.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return n.toFixed(0);
  }
  return s;
}

/** Shape raw rows into header + data rows: first non-empty row is the header, blank rows are dropped, rows padded. */
export function shapeSheet(raw: unknown[][]): ParsedSheet {
  const rows = raw.map((r) => r.map(cellToString));
  const firstIdx = rows.findIndex((r) => r.some((c) => c !== ""));
  if (firstIdx === -1) throw new ImportError("The file has no data.");
  const head = rows[firstIdx];
  let width = head.length;
  while (width > 0 && head[width - 1] === "") width--;
  if (width === 0) throw new ImportError("The first row has no column headers.");
  const seen = new Map<string, number>();
  const headers = head.slice(0, width).map((h, i) => {
    let name = h || `Column ${i + 1}`;
    const n = (seen.get(name.toLowerCase()) ?? 0) + 1;
    seen.set(name.toLowerCase(), n);
    if (n > 1) name = `${name} (${n})`;
    return name;
  });
  const data: string[][] = [];
  for (const r of rows.slice(firstIdx + 1)) {
    if (!r.some((c) => c !== "")) continue;
    const padded = r.slice(0, width);
    while (padded.length < width) padded.push("");
    data.push(padded);
  }
  if (!data.length) throw new ImportError("The file has headers but no rows.");
  if (data.length > MAX_ROWS) throw new ImportError(`The file has ${data.length.toLocaleString()} rows. The limit is ${MAX_ROWS.toLocaleString()}; split it and import in parts.`);
  return { headers, rows: data };
}

export async function parseSpreadsheet(file: FileLike): Promise<ParsedSheet> {
  const name = file.name.toLowerCase();
  const isCsv = name.endsWith(".csv");
  const isXlsx = name.endsWith(".xlsx");
  if (!isCsv && !isXlsx) throw new ImportError("Upload a .csv or .xlsx file.");
  if (file.size > MAX_BYTES) throw new ImportError("The file is larger than 2.5 MB. Split it and import it in parts.");
  if (file.size === 0) throw new ImportError("The file is empty.");
  const buf = Buffer.from(await file.arrayBuffer());

  if (isXlsx) {
    // .xlsx is a zip archive: it must start with "PK".
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new ImportError("This is not a valid .xlsx file. Re-save it from Excel as .xlsx or .csv.");
    try {
      return shapeSheet(xlsxToTable(new Uint8Array(buf)));
    } catch (e) {
      if (e instanceof ImportError) throw e;
      throw new ImportError("Could not read the Excel file. Re-save it as .xlsx or export it to .csv.");
    }
  }

  const text = buf.toString("utf8").replace(/^﻿/, "");
  const data = parseCsv(text);
  if (!data.length) throw new ImportError("The file has no data.");
  return shapeSheet(data);
}
