/**
 * Purchase order numbers: PO-<financial year>-<4-digit serial>, for example PO-2026-27-0001. The financial year runs April to March in
 * India (IST), and the serial starts again at 0001 each year. Pure functions, so they are unit-tested directly.
 */

export const PO_STATUSES = ["draft", "sent", "received", "cancelled"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

/** "2026-27" for any moment from 1 April 2026 to 31 March 2027, India time. */
export function financialYear(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "numeric" }).formatToParts(at);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** "PO-2026-27-": what every number of that year starts with. */
export const poPrefix = (at: Date = new Date()) => `PO-${financialYear(at)}-`;

/** The serial after the highest one of the year: ("PO-2026-27-", "PO-2026-27-0041") → "PO-2026-27-0042". */
export function nextPoNo(prefix: string, highest: string | null): string {
  const n = highest && highest.startsWith(prefix) ? Number(highest.slice(prefix.length)) || 0 : 0;
  return `${prefix}${String(n + 1).padStart(4, "0")}`;
}
