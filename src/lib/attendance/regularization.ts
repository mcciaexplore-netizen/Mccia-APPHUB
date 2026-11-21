/**
 * Regularization: correcting a genuinely missed punch. Pure.
 *
 * Eligible: a past day within the window (31 days by default) and on or after the go-live date, with no live request for it already, not on full-day leave, and either
 *   - checked in but never checked out → the check-out is corrected ("checkout"), or
 *   - a working day with no punch at all → both times are given ("both").
 * A day with both punches has nothing missed; a holiday or weekly off with no punch was not a working day. Today cannot be regularized
 * (check in or out instead). An approved request writes the corrected times onto the day (and links it).
 */

import type { MissedPunch } from "@/db/attendance-schema";
import type { DayKind } from "./calendar";
import { addDays, formatHm, parseHm } from "./time";

export type Eligibility = { ok: true; missed: MissedPunch[] } | { ok: false; reason: string };

export function regularizationEligibility(i: {
  day: string;
  today: string;
  windowDays: number;
  kind: DayKind;
  onFullLeave: boolean;
  liveRequest: boolean;
  record: { checkIn: boolean; checkOut: boolean } | null;
  /** The first day attendance counts: nothing before it is regularized. */
  goLive?: string | null;
}): Eligibility {
  if (i.day >= i.today) return { ok: false, reason: "Only a past day can be regularized. For today, check in or out." };
  if (i.goLive && i.day < i.goLive) return { ok: false, reason: "Attendance was not being tracked yet on that day." };
  if (i.day < addDays(i.today, -i.windowDays)) return { ok: false, reason: `Only the last ${i.windowDays} days can be regularized.` };
  if (i.liveRequest) return { ok: false, reason: "There is already a regularization request for that day." };
  if (i.onFullLeave) return { ok: false, reason: "You were on leave that day." };
  if (i.record?.checkIn && i.record.checkOut) return { ok: false, reason: "Both punches are recorded for that day: nothing was missed." };
  if (i.record?.checkIn) return { ok: true, missed: ["checkout"] };
  if (i.kind !== "working") return { ok: false, reason: "That was not a working day." };
  return { ok: true, missed: ["both"] };
}

/** The corrected times, checked: present where needed, between 06:00 and 23:59, check-out after check-in. Times are "HH:MM". */
export function checkRegularizationTimes(i: {
  missed: MissedPunch;
  checkIn: string | null | undefined;
  checkOut: string | null | undefined;
  /** For "checkout": the check-in already recorded (minutes past midnight). */
  recordedCheckInMin?: number | null;
}): { ok: true; checkInMin: number | null; checkOutMin: number | null } | { ok: false; error: string } {
  const inMin = i.missed === "checkout" ? null : parseHm(i.checkIn);
  const outMin = i.missed === "checkin" ? null : parseHm(i.checkOut);
  if (i.missed !== "checkout" && inMin == null) return { ok: false, error: "Enter the check-in time." };
  if (i.missed !== "checkin" && outMin == null) return { ok: false, error: "Enter the check-out time." };
  const early = 6 * 60;
  if (inMin != null && inMin < early) return { ok: false, error: "The check-in time must be 06:00 or later." };
  const start = inMin ?? i.recordedCheckInMin ?? null;
  if (outMin != null && start != null && outMin <= start) return { ok: false, error: `The check-out must be after the check-in (${formatHm(start)}).` };
  return { ok: true, checkInMin: inMin, checkOutMin: outMin };
}
