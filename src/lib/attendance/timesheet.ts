/**
 * Time tracking: hours logged per project per day, gathered into a weekly timesheet (Monday to Sunday) that is submitted for approval.
 * A submitted or approved week is locked; a rejected week opens again for changes and resubmission. Pure.
 */

import type { TimesheetStatus } from "@/db/attendance-schema";
import { addDays, isDay, weekStart } from "./time";

export const canEditWeek = (status: TimesheetStatus | null | undefined) => !status || status === "draft" || status === "rejected";

export const weekDays = (start: string) => Array.from({ length: 7 }, (_, i) => addDays(start, i));

/** Every rule on one time entry; the first broken one, or null. `otherHoursThatDay` is what is already logged that day (not this entry). */
export function checkTimeEntry(e: { date: string; hours: number; today: string; otherHoursThatDay: number; status: TimesheetStatus | null; description: string }): string | null {
  if (!isDay(e.date)) return "Choose the date.";
  if (e.date > e.today) return "Time cannot be logged for a future day.";
  if (!canEditWeek(e.status)) return "That week has been submitted and is locked until it is rejected.";
  if (!Number.isFinite(e.hours) || e.hours <= 0) return "Enter the hours (more than 0).";
  if (Math.round(e.hours * 4) !== e.hours * 4) return "Hours go in quarters (0.25, 0.5, 0.75 …).";
  if (e.otherHoursThatDay + e.hours > 24) return "A day cannot have more than 24 hours logged.";
  if (e.description.length > 500) return "The description is too long (500 characters at most).";
  return null;
}

/** Whether a week may be submitted. */
export function checkSubmitWeek(w: { start: string; today: string; status: TimesheetStatus | null; totalHours: number }): string | null {
  if (weekStart(w.start) !== w.start) return "Weeks start on a Monday.";
  if (w.start > w.today) return "A week can be submitted once it has started.";
  if (!canEditWeek(w.status)) return w.status === "approved" ? "That week is already approved." : "That week is already submitted.";
  if (w.totalHours <= 0) return "Log some time before submitting the week.";
  return null;
}
