/**
 * The values the scroll time picker offers (pure, used by the picker and its tests): hours 00–23 and minutes in 5-minute steps. A time
 * already saved off the 5-minute grid (an old shift starting 09:47) keeps its own minute in the list, so opening the picker never changes
 * it without the person choosing to.
 */

export const MINUTE_STEP = 5;

const pad = (n: number) => String(n).padStart(2, "0");

export const WHEEL_HOURS: number[] = Array.from({ length: 24 }, (_, h) => h);

export function wheelMinutes(current?: number | null): number[] {
  const steps = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);
  if (current == null || current < 0 || current > 59 || current % MINUTE_STEP === 0) return steps;
  return [...steps, current].sort((a, b) => a - b);
}

/** "HH:MM" → [hours, minutes], or the fallback for anything else. */
export function splitHm(value: string | null | undefined, fallback: [number, number] = [10, 0]): [number, number] {
  const m = /^(\d{1,2}):(\d{2})/.exec(value ?? "");
  if (!m) return fallback;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? [h, min] : fallback;
}

export const joinHm = (h: number, m: number) => `${pad(h)}:${pad(m)}`;

/** "17:30" → "5:30 PM", the 12-hour reading shown under the wheel. */
export function hm12(value: string): string {
  const [h, m] = splitHm(value);
  return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? "AM" : "PM"}`;
}

/** The index a scroll position settles on: the nearest row, kept inside the list. */
export const snapIndex = (scrollTop: number, rowHeight: number, count: number) => Math.min(count - 1, Math.max(0, Math.round(scrollTop / rowHeight)));
