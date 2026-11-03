/** The kinds of file DesignDesk accepts, by extension, and a safe stored name. Pure, so the upload widget can check before sending. */

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  zip: "application/zip",
  mp4: "video/mp4",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  cdr: "application/vnd.corel-draw",
  ai: "application/postscript",
  eps: "application/postscript",
  psd: "image/vnd.adobe.photoshop",
  indd: "application/x-indesign",
  fig: "application/octet-stream",
  ttf: "font/ttf",
  otf: "font/otf",
};

export const ACCEPT = Object.keys(MIME).map((e) => `.${e}`).join(",");

export function mimeFor(name: string): string | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return MIME[ext] ?? null;
}

/** Letters, digits, spaces, dots, dashes and underscores; at most 120 characters, keeping the extension. Empty when nothing is left. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.normalize("NFKD").replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").replace(/^[.\s]+/, "").trim();
  if (cleaned.length <= 120 || !cleaned.includes(".")) return cleaned.slice(0, 120);
  const ext = cleaned.slice(cleaned.lastIndexOf(".")).slice(0, 12);
  return cleaned.slice(0, 120 - ext.length) + ext;
}

export const isImage = (mime: string) => mime.startsWith("image/") && mime !== "image/vnd.adobe.photoshop";

/** The library's file-type filter: pictures, PDFs, and vector or source artwork (SVG, AI, EPS, CorelDRAW). */
export type FileKind = "image" | "pdf" | "vector" | "other";
export function fileKind(mime: string): FileKind {
  if (mime === "image/svg+xml" || mime === "application/postscript" || mime === "application/vnd.corel-draw") return "vector";
  if (mime === "application/pdf") return "pdf";
  if (isImage(mime)) return "image";
  return "other";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
