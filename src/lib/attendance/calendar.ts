/**
 * Which days are working days, and what a day was (or will be) for one person. Pure, shared by the pages, the reports and the unit tests.
 *
 * Working schedule: Monday to Friday work; Sunday always off; a Saturday is off when its place in the month is in `offSaturdays` (2nd and
 * 4th by default, so the 1st, 3rd and 5th are worked: the same rule as DesignDesk). Holidays (att_holidays, not optional) are off.
 * Optional holidays are working days that may be taken as leave.
 */

import type { DayStatus } from "@/db/attendance-schema";
import { weekday } from "./time";

export type DayKind = "working" | "weekly_off" | "holiday";
export type Calendar = { holidays: ReadonlyMap<string, { name: string; isOptional: boolean }>; offSaturdays: readonly number[] };

/** 1 for the first Saturday of the month, 2 for the second … */
export const nthOfMonth = (day: string) => Math.ceil(Number(day.slice(8, 10)) / 7);

export function isWeeklyOff(day: string, offSaturdays: readonly number[]): boolean {
  const wd = weekday(day);
  if (wd === 0) return true;
  return wd === 6 && offSaturdays.includes(nthOfMonth(day));
}

export function dayKind(day: string, cal: Calendar): DayKind {
  const h = cal.holidays.get(day);
  if (h && !h.isOptional) return "holiday";
  return isWeeklyOff(day, cal.offSaturdays) ? "weekly_off" : "working";
}

export const workingDays = (days: readonly string[], cal: Calendar) => days.filter((d) => dayKind(d, cal) === "working");

// ── A person's day ────────────────────────────────────────────────────────

export type ShiftHours = { startMin: number; endMin: number; graceMinutes: number; fullDayHours: number; halfDayHours: number };

/**
 * A finished day's status from the hours worked: a full day is the shift's full hours less the grace allowed at the start (so someone who
 * arrives within the grace and leaves at the shift's end is present); at least the half-day hours is a half day; less is absent.
 */
export function statusForHours(hours: number, shift: ShiftHours, wfh = false): DayStatus {
  if (hours >= shift.fullDayHours - shift.graceMinutes / 60) return wfh ? "wfh" : "present";
  if (hours >= shift.halfDayHours) return "half_day";
  return "absent";
}

export type PunchRecord = { checkIn: Date | null; checkOut: Date | null; status: DayStatus; isWfh: boolean; isExtraWork: boolean; isLate: boolean; isEarlyOut: boolean; hoursWorked: number | null; deficitHours?: number | null; excessHours?: number | null };
export type DayView = {
  day: string;
  kind: DayKind;
  /** What the day counts as. "pending" = today, no punch yet; "upcoming" = a future day; "untracked" = before the go-live date. */
  status: DayStatus | "pending" | "upcoming" | "untracked";
  holidayName?: string;
  leave?: { half: "none" | "first" | "second"; typeName: string; color: string } | null;
  wfh: boolean;
  record?: PunchRecord | null;
  /** Checked in but never checked out, on a day that is over: counted absent until regularized. */
  missedCheckout: boolean;
};

/**
 * One day for one person, from the calendar and what is recorded. A day before the go-live date is not tracked (its punch, if any, is still
 * shown). From go-live on, precedence: a punch, then full-day leave, then holiday / weekly off.
 */
export function resolveDay(input: {
  day: string;
  today: string;
  cal: Calendar;
  record?: PunchRecord | null;
  leave?: DayView["leave"];
  wfhApproved?: boolean;
  /** The first day attendance counts (settings.ts effectiveGoLive). */
  goLive?: string | null;
}): DayView {
  const { day, today, cal, record, leave = null } = input;
  const kind = dayKind(day, cal);
  const holidayName = cal.holidays.get(day)?.name;
  const base = { day, kind, holidayName, leave, wfh: !!input.wfhApproved || !!record?.isWfh, record: record ?? null, missedCheckout: false };
  if (input.goLive && day < input.goLive) return { ...base, status: "untracked" };
  if (record?.checkIn) {
    if (!record.checkOut) {
      if (day < today) return { ...base, status: "absent", missedCheckout: true };
      return { ...base, status: record.isWfh ? "wfh" : "present" };
    }
    return { ...base, status: record.status };
  }
  if (leave && leave.half === "none") return { ...base, status: "leave" };
  if (kind === "holiday") return { ...base, status: "holiday" };
  if (kind === "weekly_off") return { ...base, status: "weekly_off" };
  if (day > today) return { ...base, status: "upcoming" };
  if (day === today) return { ...base, status: "pending" };
  // A past working day with half-day leave and no punch: the other half was not worked.
  return { ...base, status: leave ? "half_day" : "absent" };
}

export const STATUS_LABEL: Record<DayView["status"], string> = {
  present: "Present",
  absent: "Absent",
  half_day: "Half day",
  holiday: "Holiday",
  weekly_off: "Weekly off",
  leave: "On leave",
  wfh: "WFH",
  pending: "Not checked in",
  upcoming: "Upcoming",
  untracked: "—",
};

/** Colour key for a status (the CSS has att-st-<key>). */
export const STATUS_TONE: Record<DayView["status"], "green" | "red" | "amber" | "purple" | "grey" | "blue" | "teal" | "none"> = {
  present: "green",
  absent: "red",
  half_day: "amber",
  holiday: "purple",
  weekly_off: "grey",
  leave: "blue",
  wfh: "teal",
  pending: "none",
  upcoming: "none",
  untracked: "none",
};

/** The plan for a coming day, for the Work Schedule widget. */
export function planLabel(v: DayView): string {
  if (v.leave?.half === "none") return `Leave · ${v.leave.typeName}`;
  if (v.kind === "holiday") return v.holidayName ? `Holiday · ${v.holidayName}` : "Holiday";
  if (v.kind === "weekly_off") return "Weekly off";
  if (v.leave) return `Half-day leave (${v.leave.half} half)`;
  if (v.wfh) return "Work from home";
  const opt = v.holidayName ? ` · optional holiday: ${v.holidayName}` : "";
  return `Working${opt}`;
}
