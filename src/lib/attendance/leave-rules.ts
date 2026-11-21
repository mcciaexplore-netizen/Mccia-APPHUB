/**
 * Leave: how many days a request is, what a person is entitled to and has left, and every check on a new request. Pure, so the form, the
 * server and the unit tests agree.
 *
 * Balance = accrued entitlement + carried forward + HR adjustments − booked (approved) − pending. A request holds its days while pending,
 * so two requests cannot both spend the same balance.
 *
 * Entitlement: the type's days per year, prorated by whole months for someone who joins during the year (the joining month counts).
 * Monthly accrual earns it month by month (at the start of each month); full-year makes it all available on 1 January (or on joining).
 * Amounts are rounded down to the half day. Carry forward: what was left at the end of last year, up to the type's cap (0 = none).
 *
 * Past dates: allowed only for types needing no notice (Sick Leave), and only as far back as the regularization window. Future dates need
 * the type's notice in days. A day already checked in cannot be taken as leave, except as second-half leave (leaving early).
 */

import type { HalfDay, LeaveType } from "@/db/attendance-schema";
import { dayKind, type Calendar } from "./calendar";
import { addDays, daysBetween, eachDay, formatDay, isDay } from "./time";

export const floorHalf = (n: number) => Math.floor(n * 2 + 1e-9) / 2;

/** How many leave days a request takes: weekly offs and holidays are not counted unless the type counts them; a half day is 0.5. */
export function leaveDays(input: { start: string; end: string; halfDay: HalfDay; countWeekends: boolean; cal: Calendar }): number {
  if (!isDay(input.start) || !isDay(input.end) || input.end < input.start) return 0;
  const counts = (d: string) => input.countWeekends || dayKind(d, input.cal) === "working";
  if (input.halfDay !== "none") return input.start === input.end && counts(input.start) ? 0.5 : 0;
  return eachDay(input.start, input.end).filter(counts).length;
}

/** The first month (1-12) of `year` a person is entitled for: 1 unless they joined during it; 13 if they join after it. */
export function startMonth(year: number, dateOfJoining: string | null): number {
  if (!dateOfJoining || !isDay(dateOfJoining)) return 1;
  const jy = Number(dateOfJoining.slice(0, 4));
  if (jy < year) return 1;
  if (jy > year) return 13;
  return Number(dateOfJoining.slice(5, 7));
}

/** The year's full entitlement, prorated for a joiner (see the header). */
export function entitlementFor(daysPerYear: number, year: number, dateOfJoining: string | null): number {
  const m = startMonth(year, dateOfJoining);
  if (m > 12) return 0;
  return floorHalf((daysPerYear * (13 - m)) / 12);
}

/** How much of the year's entitlement is available on `today`: all of it (full-year), or the months reached so far (monthly). */
export function accrued(input: { entitled: number; accrualType: "full_year" | "monthly"; year: number; today: string; dateOfJoining: string | null }): number {
  const ty = Number(input.today.slice(0, 4));
  if (input.year > ty) return 0;
  const m = startMonth(input.year, input.dateOfJoining);
  if (m > 12) return 0;
  if (input.dateOfJoining && input.dateOfJoining > input.today) return 0;
  if (input.accrualType === "full_year" || input.year < ty) return input.entitled;
  const total = 13 - m;
  const reached = Math.min(total, Math.max(0, Number(input.today.slice(5, 7)) - m + 1));
  return floorHalf((input.entitled * reached) / total);
}

/** What comes over from last year: what was left, never negative, at most the cap. */
export const carryForward = (leftLastYear: number, cap: number) => Math.max(0, Math.min(floorHalf(leftLastYear), Math.max(0, cap)));

export type BalanceParts = { accrued: number; carried: number; adjusted: number; booked: number; pending: number };
/** Days a person can still ask for. */
export const balanceOf = (b: BalanceParts) => Math.round((b.accrued + b.carried + b.adjusted - b.booked - b.pending) * 100) / 100;

export type LeaveRule = Pick<
  LeaveType,
  "name" | "isActive" | "availableTo" | "allowHalfDay" | "halfDayFirst" | "halfDaySecond" | "maxConsecutiveDays" | "noticePeriodDays" | "requiresDocumentAfterDays" | "requiresReason" | "countWeekends"
>;

export type LeaveCheck = {
  type: LeaveRule;
  employmentType: "intern" | "consultant" | "staff";
  start: string;
  end: string;
  halfDay: HalfDay;
  /** leaveDays() for this request. */
  days: number;
  today: string;
  /** How far back a past-dated (no-notice) leave may go. */
  windowDays: number;
  reason: string;
  hasAttachment: boolean;
  /** Days in the range the person has checked in on. */
  checkedInDays: ReadonlySet<string>;
  /** Whether a pending or approved leave already covers any of these days. */
  overlaps: boolean;
  /** Days left of this type (or comp-off available on the start date). */
  available: number;
};

/** Every rule on a new leave request; the first broken one, in words, or null when it may be sent. */
export function checkLeave(c: LeaveCheck): string | null {
  if (!isDay(c.start) || !isDay(c.end)) return "Choose the dates.";
  if (c.end < c.start) return "The end date is before the start date.";
  if (daysBetween(c.start, c.end) > 90) return "A request can cover at most 90 days. Split it into parts.";
  if (!c.type.isActive) return `${c.type.name} is no longer offered.`;
  if (c.type.availableTo !== "all" && c.type.availableTo !== c.employmentType) return `${c.type.name} is not available to you.`;
  if (c.halfDay !== "none") {
    if (!c.type.allowHalfDay) return `${c.type.name} cannot be taken as a half day.`;
    if (c.start !== c.end) return "A half day is for a single date.";
    if (c.halfDay === "first" && !c.type.halfDayFirst) return `${c.type.name} cannot be taken for the first half.`;
    if (c.halfDay === "second" && !c.type.halfDaySecond) return `${c.type.name} cannot be taken for the second half.`;
  }
  if (c.days <= 0) return "Those dates are all weekly offs or holidays, so no leave is needed.";
  if (c.type.maxConsecutiveDays != null && c.days > c.type.maxConsecutiveDays) return `${c.type.name} can be at most ${c.type.maxConsecutiveDays} days in one go.`;
  if (c.start < c.today) {
    if (c.type.noticePeriodDays > 0) return `${c.type.name} cannot be applied for past dates.`;
    if (c.start < addDays(c.today, -c.windowDays)) return `Leave can be applied at most ${c.windowDays} days back.`;
  } else if (daysBetween(c.today, c.start) < c.type.noticePeriodDays) {
    const n = c.type.noticePeriodDays;
    return `${c.type.name} needs ${n} day${n === 1 ? "" : "s"}' notice: the earliest start is ${formatDay(addDays(c.today, n))}.`;
  }
  if (c.type.requiresReason && c.reason.trim().length < 3) return `Give a reason for ${c.type.name}.`;
  if (c.type.requiresDocumentAfterDays != null && c.days > c.type.requiresDocumentAfterDays && !c.hasAttachment)
    return `${c.type.name} of more than ${c.type.requiresDocumentAfterDays} days needs a supporting document (for example a doctor's note).`;
  for (const d of eachDay(c.start, c.end)) {
    if (c.checkedInDays.has(d) && !(c.halfDay === "second" && c.start === c.end)) return `You checked in on ${formatDay(d)}, so it cannot be leave (second-half leave is still possible).`;
  }
  if (c.overlaps) return "You already have leave on some of these days.";
  if (c.days > c.available) return `Not enough ${c.type.name}: ${c.days} day${c.days === 1 ? "" : "s"} asked, ${Math.max(0, c.available)} left.`;
  return null;
}

/** A request can be cancelled by its owner while pending, or once approved if it has not started yet. */
export const canCancelLeave = (r: { status: string; startDate: string }, today: string) => r.status === "pending" || (r.status === "approved" && r.startDate > today);
