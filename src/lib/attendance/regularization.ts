/**
 * Regularization: correcting a genuinely missed punch. Pure.
 *
 * Eligible: a past day within the window (31 days by default) and on or after the go-live date, with no live request for it already, not on full-day leave, and either
 *   - checked in but never checked out → the check-out is corrected ("checkout"), or
 *   - a check-out with no check-in recorded → the check-in is corrected ("checkin"), or
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
  if (i.record?.checkOut) return { ok: true, missed: ["checkin"] };
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
  /** For "checkin": the check-out already recorded (minutes past midnight). */
  recordedCheckOutMin?: number | null;
}): { ok: true; checkInMin: number | null; checkOutMin: number | null } | { ok: false; error: string } {
  const inMin = i.missed === "checkout" ? null : parseHm(i.checkIn);
  const outMin = i.missed === "checkin" ? null : parseHm(i.checkOut);
  if (i.missed !== "checkout" && inMin == null) return { ok: false, error: "Enter the check-in time." };
  if (i.missed !== "checkin" && outMin == null) return { ok: false, error: "Enter the check-out time." };
  const early = 6 * 60;
  if (inMin != null && inMin < early) return { ok: false, error: "The check-in time must be 06:00 or later." };
  const start = inMin ?? i.recordedCheckInMin ?? null;
  if (outMin != null && start != null && outMin <= start) return { ok: false, error: `The check-out must be after the check-in (${formatHm(start)}).` };
  if (inMin != null && outMin == null && i.recordedCheckOutMin != null && inMin >= i.recordedCheckOutMin) return { ok: false, error: `The check-in must be before the check-out (${formatHm(i.recordedCheckOutMin)}).` };
  return { ok: true, checkInMin: inMin, checkOutMin: outMin };
}

// ── Past days, as cards ───────────────────────────────────────────────────

/**
 * What a past day's card on the Regularization page shows: what is missing (and can still be corrected), or a request already in for it
 * (grey, nothing to edit: waiting for a decision, or the day was corrected).
 */
export type PastCardState = "missing_checkin" | "missing_checkout" | "missing_both" | "pending" | "regularized";

export function pastCardState(i: { missed: MissedPunch | null; request: "pending" | "approved" | null }): PastCardState | null {
  if (i.request === "approved") return "regularized";
  if (i.request === "pending") return "pending";
  if (i.missed === "checkin") return "missing_checkin";
  if (i.missed === "checkout") return "missing_checkout";
  if (i.missed === "both") return "missing_both";
  return null;
}

export const PAST_CARD_TEXT: Record<PastCardState, { label: string; action: string | null }> = {
  missing_checkin: { label: "Missed check-in", action: "Add check-in time" },
  missing_checkout: { label: "Missed check-out", action: "Add check-out time" },
  missing_both: { label: "Missed check-in and check-out", action: "Add both times" },
  pending: { label: "Request sent · waiting for approval", action: null },
  regularized: { label: "Regularized", action: null },
};

// ── Planned working days (the days ahead) ─────────────────────────────────

/** How far ahead a working day can be planned. */
export const PLAN_AHEAD_DAYS = 30;

/**
 * Whether a day ahead can be planned (its check-in and check-out times given in advance, for the manager to approve): from tomorrow up to
 * PLAN_AHEAD_DAYS ahead, a working day, not on full-day leave, and not planned already (a pending or approved plan).
 */
export function planEligibility(i: { day: string; today: string; kind: DayKind; onFullLeave: boolean; livePlan: boolean; aheadDays?: number }): { ok: true } | { ok: false; reason: string } {
  const ahead = i.aheadDays ?? PLAN_AHEAD_DAYS;
  if (i.day <= i.today) return { ok: false, reason: "Only a day from tomorrow on can be planned. For a past day, correct the missed punch instead." };
  if (i.day > addDays(i.today, ahead)) return { ok: false, reason: `A day can be planned at most ${ahead} days ahead.` };
  if (i.kind !== "working") return { ok: false, reason: "That is not a working day." };
  if (i.onFullLeave) return { ok: false, reason: "You are on leave that day." };
  if (i.livePlan) return { ok: false, reason: "That day is already planned." };
  return { ok: true };
}

/** A plan's times, checked: both given, the check-in from 06:00, the check-out after it. Times are "HH:MM". */
export function checkPlanTimes(checkIn: unknown, checkOut: unknown): { ok: true; checkInMin: number; checkOutMin: number } | { ok: false; error: string } {
  const inMin = parseHm(checkIn);
  const outMin = parseHm(checkOut);
  if (inMin == null) return { ok: false, error: "Choose the check-in time." };
  if (outMin == null) return { ok: false, error: "Choose the check-out time." };
  if (inMin < 6 * 60) return { ok: false, error: "The check-in time must be 06:00 or later." };
  if (outMin <= inMin) return { ok: false, error: `The check-out must be after the check-in (${formatHm(inMin)}).` };
  return { ok: true, checkInMin: inMin, checkOutMin: outMin };
}
