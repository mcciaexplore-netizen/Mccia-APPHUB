// All reporting is in Indian Standard Time (UTC+5:30, no daylight saving).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Start of the IST calendar day containing `d`, as a real instant. */
export function istDayStart(d: Date = new Date()): Date {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - IST_OFFSET_MS);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/** Parse "YYYY-MM-DD" as an IST day start. */
export function parseIstDate(s: string | undefined | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toIstDateString(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export type RangeKey = "today" | "week" | "month" | "custom";

export type DateRange = { from: Date; to: Date; key: RangeKey; fromStr: string; toStr: string };

/** `to` is exclusive (start of the day after the last included day). */
export function resolveRange(params: { range?: string; from?: string; to?: string }): DateRange {
  const today = istDayStart();
  const key = (["today", "week", "month", "custom"].includes(params.range ?? "") ? params.range : "today") as RangeKey;
  let from = today;
  let to = addDays(today, 1);
  if (key === "week") from = addDays(today, -6);
  if (key === "month") from = addDays(today, -29);
  if (key === "custom") {
    const f = parseIstDate(params.from);
    const t = parseIstDate(params.to);
    if (f && t && t >= f) {
      from = f;
      to = addDays(t, 1);
    }
  }
  return { from, to, key, fromStr: toIstDateString(from), toStr: toIstDateString(addDays(to, -1)) };
}

export function formatIst(d: Date | string | null | undefined, opts: Intl.DateTimeFormatOptions = {}): string {
  if (!d) return "–";
  return new Date(d).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    ...opts,
  });
}

export function formatDuration(sec: number | null | undefined): string {
  if (!sec || sec <= 0) return "0s";
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600);
    return `${h}h ${String(Math.floor((sec % 3600) / 60)).padStart(2, "0")}m`;
  }
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}
