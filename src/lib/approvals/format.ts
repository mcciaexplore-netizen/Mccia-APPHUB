/** Money is integer paise everywhere; these are the only places that turn it into text and back. Dates are UTC in the database, shown in IST. */

const GROUPED = new Intl.NumberFormat("en-IN");

/** 123456700 -> "12,34,567.00". Negative values keep their sign: -50000 -> "-500.00". */
export function formatINR(paise: number | null | undefined, opts: { symbol?: boolean } = {}): string {
  if (paise == null || !Number.isFinite(paise)) return "";
  const abs = Math.abs(Math.trunc(paise));
  const text = `${GROUPED.format(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, "0")}`;
  return `${paise < 0 ? "-" : ""}${opts.symbol ? "₹" : ""}${text}`;
}

/** What a person typed into a money box -> paise, or null when it is not a valid amount. Accepts commas, spaces and the rupee sign. */
export function parseINR(input: string): number | null {
  const s = input.replace(/[\s,₹]/g, "");
  const m = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const IST = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function parts(d: Date) {
  const p = Object.fromEntries(IST.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: p.day, hh: p.hour, mm: p.minute, ss: p.second };
}

/** "13-Oct-2026" */
export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const p = parts(new Date(d));
  return `${p.d}-${MONTHS[p.m - 1]}-${p.y}`;
}

/** "13-Oct-2026 14:05:09" */
export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "";
  const p = parts(new Date(d));
  return `${p.d}-${MONTHS[p.m - 1]}-${p.y} ${p.hh}:${p.mm}:${p.ss}`;
}

/** Indian financial year (April to March) of an instant, judged in IST: 2026-10-13 -> "2026-27", 2027-03-31 -> "2026-27". */
export function financialYearOf(d: Date = new Date()): string {
  const { y, m } = parts(d);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** "2026-27" is valid; "2026-28" and "26-27" are not. */
export function isFinancialYear(fy: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(fy);
  return !!m && (Number(m[1]) + 1) % 100 === Number(m[2]);
}

/** The last few financial years around today, newest first, for pickers. */
export function recentFinancialYears(count = 4, from: Date = new Date()): string[] {
  const start = Number(financialYearOf(from).slice(0, 4)) + 1; // include next year, so budgets can be set ahead
  return Array.from({ length: count }, (_, i) => `${start - i}-${String((start - i + 1) % 100).padStart(2, "0")}`);
}
