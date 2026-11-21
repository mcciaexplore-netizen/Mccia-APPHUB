/**
 * Days and clock times in India time (IST, UTC+5:30, no daylight saving). Every day in Attendance is a "YYYY-MM-DD" string in IST and every
 * clock time minutes since IST midnight, so the server (UTC on Vercel), the browser and the unit tests all agree. Pure: no server code.
 */

export const IST_OFFSET_MIN = 330;
const DAY_MS = 86_400_000;

const pad = (n: number) => String(n).padStart(2, "0");

/** The IST day a moment falls on. */
export function istDay(at: Date | number = Date.now()): string {
  return new Date(+at + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** Minutes since IST midnight for a moment. */
export function istMinutes(at: Date | number = Date.now()): number {
  const d = new Date(+at + IST_OFFSET_MIN * 60_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** The moment that is `minutes` past IST midnight on `day`. */
export function istMoment(day: string, minutes: number): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + (minutes - IST_OFFSET_MIN) * 60_000);
}

export const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (b − a). */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** 0 = Sunday … 6 = Saturday. */
export const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

/** Every day from `from` to `to`, both included (at most 400, so a bad range cannot run away). */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The Monday of the week `day` is in (weeks run Monday to Sunday). */
export function weekStart(day: string): string {
  return addDays(day, -((weekday(day) + 6) % 7));
}

/** "2026-11" → first and last day of that month. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
}

export const isMonth = (s: unknown): s is string => typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/** "10:00" or "10:00:00" → 600. Null for anything else. */
export function parseHm(s: unknown): number | null {
  const m = typeof s === "string" ? s.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 600 → "10:00". */
export const formatHm = (minutes: number) => `${pad(Math.floor(minutes / 60) % 24)}:${pad(Math.round(minutes) % 60)}`;

/** A moment's IST clock time, "09:58". */
export const istClock = (at: Date | string | number) => formatHm(istMinutes(new Date(at)));

/** 7.25 → "7h 15m"; 0 → "0h". */
export function formatHours(h: number | null | undefined): string {
  if (h == null || !Number.isFinite(h)) return "—";
  const total = Math.round(Math.abs(h) * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${h < 0 ? "−" : ""}${hh}h${mm ? ` ${mm}m` : ""}`;
}

/** Seconds → "07:15:03". */
export function formatClockDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "2026-11-21" → "21 Nov 2026". */
export function formatDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
/** "2026-11-21" → "Sat 21 Nov". */
export function formatDayShort(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${DAYS[weekday(day)]} ${d} ${MONTHS[m - 1]}`;
}
export const weekdayName = (day: string) => DAYS[weekday(day)];
/** "2026-11" → "November 2026". */
export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-GB", { month: "long", timeZone: "UTC" })} ${y}`;
}
/** A moment as "21 Nov 2026, 10:04" in IST. */
export function formatMoment(at: Date | string): string {
  const d = new Date(at);
  return `${formatDay(istDay(d))}, ${istClock(d)}`;
}

/** Hours rounded to two decimals (what the numeric(6,2) columns hold). */
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** The greeting for an IST clock time: morning 5:00–11:59, afternoon 12:00–16:59, evening 17:00–20:59, night 21:00–4:59. */
export function greetingFor(minutes: number): "Good morning" | "Good afternoon" | "Good evening" | "Good night" {
  const h = Math.floor((((minutes % 1440) + 1440) % 1440) / 60);
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  if (h >= 17 && h < 21) return "Good evening";
  return "Good night";
}

const LONG_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "2025-06-24" → "Tuesday, 24 June 2025". */
export function formatLongDate(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${LONG_DAYS[weekday(day)]}, ${d} ${LONG_MONTHS[m - 1]} ${y}`;
}
/** "2026-11-21" → "SAT 21 NOV". */
export const formatDayCaps = (day: string) => formatDayShort(day).toUpperCase();
