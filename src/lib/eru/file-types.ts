/**
 * File types for ERU, by extension, and a safe stored name. Pure, so the upload widget can use it too. Every type is accepted (research work
 * comes as documents, spreadsheets, data and images): a known extension gets its own type, anything else is stored as a plain download.
 * Only images and PDFs are ever shown in the page; everything else downloads.
 */

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  rtf: "application/rtf",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  md: "text/markdown",
  json: "application/json",
  xml: "application/xml",
  zip: "application/zip",
  sav: "application/octet-stream",
  dta: "application/octet-stream",
};

/** The type to store a file as: its own for a known extension, a plain download for anything else. */
export function mimeFor(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

/** Letters, digits, spaces, dots, dashes and underscores; at most 120 characters, keeping the extension. Empty when nothing is left. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.normalize("NFKD").replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").replace(/^[.\s]+/, "").trim();
  if (cleaned.length <= 120 || !cleaned.includes(".")) return cleaned.slice(0, 120);
  const ext = cleaned.slice(cleaned.lastIndexOf(".")).slice(0, 12);
  return cleaned.slice(0, 120 - ext.length) + ext;
}

/** A .docx file, by name (what the import accepts). */
export const isDocx = (name: string) => /\.docx$/i.test(name);

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
