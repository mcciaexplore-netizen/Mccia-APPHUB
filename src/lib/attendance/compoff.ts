/**
 * Comp-offs: a day (or half day) off earned by working a holiday or weekly off. Pure.
 *
 * Earning: claimed for a past holiday or weekly off the person checked in and out on, worked at least the shift's half-day hours for a half
 * comp-off and a full day (less grace) for a full one, and claimed before it would have expired. Once approved it expires `expiryDays`
 * (90 by default) after the day worked.
 *
 * Spending: Comp-off leave draws on approved comp-offs, OLDEST (soonest to expire) FIRST. Nothing records which comp-off a leave used: it is
 * worked out here every time by going through the leaves in date order, each drawing from comp-offs still valid on its date. What is left
 * on a comp-off past its expiry date has expired. Pending comp-off leave reserves days the same way.
 */

import type { DayKind, ShiftHours } from "./calendar";
import { addDays, formatDay } from "./time";

export type Earned = { id: string; workedDate: string; expiryDate: string; days: number };
export type Spend = { date: string; days: number };
export type EarnedState = Earned & { used: number; remaining: number; expired: boolean };

export const compoffDays = (type: "full" | "half") => (type === "half" ? 0.5 : 1);
export const expiryFor = (workedDate: string, expiryDays: number) => addDays(workedDate, expiryDays);

const byAge = (a: Earned, b: Earned) => (a.expiryDate === b.expiryDate ? a.workedDate.localeCompare(b.workedDate) : a.expiryDate.localeCompare(b.expiryDate));

/** Each comp-off's use after the spends are drawn oldest first, and what could not be covered. */
export function allocate(earned: readonly Earned[], spends: readonly Spend[], today: string): { states: EarnedState[]; uncovered: number } {
  const states: EarnedState[] = [...earned].sort(byAge).map((e) => ({ ...e, used: 0, remaining: e.days, expired: false }));
  let uncovered = 0;
  for (const s of [...spends].sort((a, b) => a.date.localeCompare(b.date))) {
    let need = s.days;
    for (const e of states) {
      if (need <= 0) break;
      if (e.remaining <= 0 || e.workedDate > s.date || e.expiryDate < s.date) continue;
      const take = Math.min(e.remaining, need);
      e.remaining -= take;
      e.used += take;
      need -= take;
    }
    uncovered += need;
  }
  for (const e of states) e.expired = e.remaining > 0 && e.expiryDate < today;
  return { states, uncovered };
}

/** Comp-off days available today (not expired, not spent or reserved). */
export function compoffBalance(earned: readonly Earned[], spends: readonly Spend[], today: string): number {
  return allocate(earned, spends, today).states.reduce((n, e) => n + (e.expired ? 0 : e.remaining), 0);
}

/** Comp-off days that could cover a leave on `date` (valid on that date and not already drawn on). */
export function availableOn(earned: readonly Earned[], spends: readonly Spend[], date: string, today: string): number {
  return allocate(earned, spends, today).states.reduce((n, e) => n + (e.workedDate <= date && e.expiryDate >= date && e.expiryDate >= today ? e.remaining : 0), 0);
}

/** Every rule on a comp-off claim; the first broken one, or null. */
export function checkCompoffClaim(c: {
  workedDate: string;
  today: string;
  kind: DayKind;
  type: "full" | "half";
  hoursWorked: number | null;
  checkedOut: boolean;
  shift: ShiftHours;
  expiryDays: number;
  alreadyClaimed: boolean;
}): string | null {
  if (c.workedDate > c.today) return "A comp-off is claimed after the day is worked.";
  if (c.kind === "working") return `${formatDay(c.workedDate)} was a working day. Comp-off is for working a holiday or weekly off.`;
  if (c.alreadyClaimed) return "You have already claimed a comp-off for that day.";
  if (!c.checkedOut || c.hoursWorked == null) return `There is no completed check-in and check-out on ${formatDay(c.workedDate)}.`;
  if (expiryFor(c.workedDate, c.expiryDays) < c.today) return `A comp-off for ${formatDay(c.workedDate)} would already have expired (${c.expiryDays} days).`;
  const half = c.shift.halfDayHours;
  const full = c.shift.fullDayHours - c.shift.graceMinutes / 60;
  if (c.type === "full" && c.hoursWorked < full) return `A full-day comp-off needs at least ${full} hours worked; you worked ${c.hoursWorked}. Claim a half day instead.`;
  if (c.hoursWorked < half) return `A comp-off needs at least ${half} hours worked; you worked ${c.hoursWorked}.`;
  return null;
}
