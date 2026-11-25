import "server-only";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "./db";
import { attendance, compoffRequests, earlyDepartures, leaveRequests, regularizationRequests, wfhRequests, type MissedPunch } from "@/db/attendance-schema";
import { AttError } from "./dal";
import { calendarFor, getSettings, profileOf } from "./config";
import { loadDays, recordOf, viewOf } from "./days";
import { dayKind } from "./calendar";
import { regularizationEligibility, checkRegularizationTimes, checkPlanTimes, pastCardState, planEligibility, PLAN_AHEAD_DAYS, type PastCardState } from "./regularization";
import { checkCompoffClaim, compoffDays, expiryFor } from "./compoff";
import { approverIdFor } from "./leave";
import { notifyNewRequest } from "./notify";
import { MAX_REASON, isUuid } from "./att.manifest";
import { effectiveGoLive } from "./settings";
import { addDays, eachDay, formatDay, formatHm, isDay, istDay, istMinutes } from "./time";

/** WFH, regularization and comp-off requests: asking, cancelling and listing (decisions are in approvals.ts). */

const cleanReason = (s: unknown, what = "a reason") => {
  const r = String(s ?? "").trim().slice(0, MAX_REASON);
  if (r.length < 3) throw new AttError(`Give ${what}.`);
  return r;
};

// ── Work from home ────────────────────────────────────────────────────────

export const WFH_MAX_AHEAD_DAYS = 60;

export async function applyWfh(user: { id: string; name: string }, input: { date: string; reason: string; planNote?: string }): Promise<{ id: string }> {
  const today = istDay();
  if (!isDay(input.date)) throw new AttError("Choose the date.");
  if (input.date < today) throw new AttError("Work from home is asked for today or a future day. For a past day, use regularization.");
  if (input.date > addDays(today, WFH_MAX_AHEAD_DAYS)) throw new AttError(`Work from home can be asked at most ${WFH_MAX_AHEAD_DAYS} days ahead.`);
  const reason = cleanReason(input.reason);
  const planNote = String(input.planNote ?? "").trim().slice(0, MAX_REASON);
  const data = await loadDays([user.id], input.date, input.date);
  const v = viewOf(data, user.id, input.date, today);
  if (v.kind !== "working") throw new AttError(`${formatDay(input.date)} is not a working day.`);
  if (v.leave?.half === "none") throw new AttError(`You are on leave on ${formatDay(input.date)}.`);
  const rec = recordOf(data, user.id, input.date);
  if (rec?.checkInTime && !rec.isWfh) throw new AttError("You have already checked in at the office today.");
  const pendingLeave = await db
    .select({ id: leaveRequests.id })
    .from(leaveRequests)
    .where(and(eq(leaveRequests.userId, user.id), eq(leaveRequests.status, "pending"), eq(leaveRequests.halfDay, "none"), lte(leaveRequests.startDate, input.date), gte(leaveRequests.endDate, input.date)));
  if (pendingLeave.length) throw new AttError(`You have a leave request pending for ${formatDay(input.date)}.`);
  const [row] = await db
    .insert(wfhRequests)
    .values({ userId: user.id, date: input.date, reason, planNote, approverId: await approverIdFor(user.id) })
    .onConflictDoNothing()
    .returning({ id: wfhRequests.id, approverId: wfhRequests.approverId });
  if (!row) throw new AttError(`You have already asked to work from home on ${formatDay(input.date)}.`);
  await notifyNewRequest({ kind: "wfh", id: row.id, requester: user, approverId: row.approverId, summary: `Work from home on ${formatDay(input.date)}: ${reason}` });
  return { id: row.id };
}

// ── Early check-out ───────────────────────────────────────────────────────

/**
 * Asks to check out today before the shift's hours are worked (check-out is otherwise refused until then). Only while checked in and not
 * yet out; one live request a day. Goes to the manager, or HR.
 */
export async function applyEarlyDeparture(user: { id: string; name: string }, input: { reason: string }): Promise<{ id: string }> {
  const today = istDay();
  const reason = cleanReason(input.reason);
  const [rec] = await db.select().from(attendance).where(and(eq(attendance.userId, user.id), eq(attendance.date, today)));
  if (!rec?.checkInTime) throw new AttError("Check in first. An early check-out is asked for after checking in.");
  if (rec.checkOutTime) throw new AttError("You have already checked out today.");
  if (rec.isExtraWork) throw new AttError("On extra work (a holiday or weekly off) you can check out at any time.");
  const [row] = await db
    .insert(earlyDepartures)
    .values({ userId: user.id, date: today, reason, approverId: await approverIdFor(user.id) })
    .onConflictDoNothing()
    .returning({ id: earlyDepartures.id, approverId: earlyDepartures.approverId });
  if (!row) throw new AttError("You have already asked to check out early today.");
  await notifyNewRequest({ kind: "early", id: row.id, requester: user, approverId: row.approverId, summary: `Check out early today (${formatDay(today)}): ${reason}` });
  return { id: row.id };
}

// ── Regularization ────────────────────────────────────────────────────────

export type RegularizableDay = { day: string; missed: MissedPunch[]; checkIn: string | null; checkOut: string | null };

/** The days in the window the person may still regularize (newest first). */
export async function regularizableDays(userId: string): Promise<RegularizableDay[]> {
  const [settings, today] = [await getSettings(), istDay()];
  const windowStart = addDays(today, -settings.regularizationWindowDays);
  const goLive = effectiveGoLive(settings, today);
  const from = goLive > windowStart ? goLive : windowStart;
  const to = addDays(today, -1);
  if (from > to) return [];
  const [data, live] = await Promise.all([
    loadDays([userId], from, to),
    db
      .select({ date: regularizationRequests.date })
      .from(regularizationRequests)
      .where(and(eq(regularizationRequests.userId, userId), eq(regularizationRequests.isFuture, false), inArray(regularizationRequests.status, ["pending", "approved"]), gte(regularizationRequests.date, from))),
  ]);
  const liveDays = new Set(live.map((l) => l.date));
  const out: RegularizableDay[] = [];
  for (const day of eachDay(from, to).reverse()) {
    const v = viewOf(data, userId, day, today);
    const r = recordOf(data, userId, day);
    const e = regularizationEligibility({
      day,
      today,
      windowDays: settings.regularizationWindowDays,
      kind: v.kind,
      onFullLeave: v.leave?.half === "none",
      liveRequest: liveDays.has(day),
      record: r ? { checkIn: !!r.checkInTime, checkOut: !!r.checkOutTime } : null,
      goLive,
    });
    if (e.ok) out.push({ day, missed: e.missed, checkIn: r?.checkInTime ? formatHm(istMinutes(r.checkInTime)) : null, checkOut: r?.checkOutTime ? formatHm(istMinutes(r.checkOutTime)) : null });
  }
  return out;
}

export async function applyRegularization(user: { id: string; name: string }, input: { date: string; missed: MissedPunch; checkIn?: string; checkOut?: string; reason: string }): Promise<{ id: string }> {
  if (!isDay(input.date)) throw new AttError("Choose the day.");
  const reason = cleanReason(input.reason);
  const [settings, today] = [await getSettings(), istDay()];
  const data = await loadDays([user.id], input.date, input.date);
  const v = viewOf(data, user.id, input.date, today);
  const r = recordOf(data, user.id, input.date);
  const live = await db
    .select({ id: regularizationRequests.id })
    .from(regularizationRequests)
    .where(and(eq(regularizationRequests.userId, user.id), eq(regularizationRequests.date, input.date), eq(regularizationRequests.isFuture, false), inArray(regularizationRequests.status, ["pending", "approved"])));
  const e = regularizationEligibility({
    day: input.date,
    today,
    windowDays: settings.regularizationWindowDays,
    kind: v.kind,
    onFullLeave: v.leave?.half === "none",
    liveRequest: live.length > 0,
    record: r ? { checkIn: !!r.checkInTime, checkOut: !!r.checkOutTime } : null,
    goLive: effectiveGoLive(settings, today),
  });
  if (!e.ok) throw new AttError(e.reason);
  if (!e.missed.includes(input.missed)) throw new AttError("Choose what was missed on that day.");
  const t = checkRegularizationTimes({
    missed: input.missed,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    recordedCheckInMin: r?.checkInTime ? istMinutes(r.checkInTime) : null,
    recordedCheckOutMin: r?.checkOutTime ? istMinutes(r.checkOutTime) : null,
  });
  if (!t.ok) throw new AttError(t.error);
  const [row] = await db
    .insert(regularizationRequests)
    .values({
      userId: user.id,
      date: input.date,
      missed: input.missed,
      requestedCheckin: t.checkInMin == null ? null : formatHm(t.checkInMin),
      requestedCheckout: t.checkOutMin == null ? null : formatHm(t.checkOutMin),
      reason,
      approverId: await approverIdFor(user.id),
    })
    .onConflictDoNothing()
    .returning({ id: regularizationRequests.id, approverId: regularizationRequests.approverId });
  if (!row) throw new AttError("There is already a regularization request for that day.");
  const times = [t.checkInMin != null ? `in ${formatHm(t.checkInMin)}` : null, t.checkOutMin != null ? `out ${formatHm(t.checkOutMin)}` : null].filter(Boolean).join(", ");
  await notifyNewRequest({ kind: "regularization", id: row.id, requester: user, approverId: row.approverId, summary: `${formatDay(input.date)}: ${times}. ${reason}` });
  return { id: row.id };
}

/** A past day's card on the Regularization page: a missed punch to correct, or (grey) a correction already asked for or made. */
export type PastDayCard = {
  day: string;
  state: PastCardState;
  missed: MissedPunch;
  /** What is recorded ("HH:MM"), or what was asked for when a request is in. */
  checkIn: string | null;
  checkOut: string | null;
};

const hm = (t: string | null) => (t ? t.slice(0, 5) : null);

/** Every day of the window with something missing or a correction asked for (newest first): what the Regularization page lays out as cards. */
export async function pastDayCards(userId: string): Promise<PastDayCard[]> {
  const [settings, today] = [await getSettings(), istDay()];
  const windowStart = addDays(today, -settings.regularizationWindowDays);
  const goLive = effectiveGoLive(settings, today);
  const from = goLive > windowStart ? goLive : windowStart;
  const to = addDays(today, -1);
  if (from > to) return [];
  const [open, asked] = await Promise.all([
    regularizableDays(userId),
    db
      .select()
      .from(regularizationRequests)
      .where(and(eq(regularizationRequests.userId, userId), eq(regularizationRequests.isFuture, false), inArray(regularizationRequests.status, ["pending", "approved"]), gte(regularizationRequests.date, from), lte(regularizationRequests.date, to))),
  ]);
  const cards: PastDayCard[] = open.map((d) => ({ day: d.day, state: pastCardState({ missed: d.missed[0], request: null })!, missed: d.missed[0], checkIn: d.checkIn, checkOut: d.checkOut }));
  for (const r of asked) {
    cards.push({ day: r.date, state: pastCardState({ missed: r.missed, request: r.status as "pending" | "approved" })!, missed: r.missed, checkIn: hm(r.requestedCheckin), checkOut: hm(r.requestedCheckout) });
  }
  return cards.sort((a, b) => b.day.localeCompare(a.day));
}

// ── Planned working days ──────────────────────────────────────────────────

export type PlanCard = {
  day: string;
  /** The plan for the day, if one is in (pending or approved), or the last one turned down (the day can be planned again). */
  plan: { id: string; status: "pending" | "approved" | "rejected"; checkIn: string; checkOut: string; reason: string; remark: string | null } | null;
};

/** The working days from tomorrow to PLAN_AHEAD_DAYS ahead, with any plan made for each. Weekly offs, holidays and full-day leave are left out. */
export async function planCards(userId: string): Promise<PlanCard[]> {
  const today = istDay();
  const from = addDays(today, 1);
  const to = addDays(today, PLAN_AHEAD_DAYS);
  const [data, plans] = await Promise.all([
    loadDays([userId], from, to),
    db
      .select()
      .from(regularizationRequests)
      .where(and(eq(regularizationRequests.userId, userId), eq(regularizationRequests.isFuture, true), inArray(regularizationRequests.status, ["pending", "approved", "rejected"]), gte(regularizationRequests.date, from), lte(regularizationRequests.date, to)))
      .orderBy(desc(regularizationRequests.createdAt)),
  ]);
  const byDay = new Map<string, (typeof plans)[number]>();
  for (const p of plans) {
    const had = byDay.get(p.date);
    // A live plan wins over a rejected one; among the same kind, the newest (the list is newest first).
    if (!had || (had.status === "rejected" && p.status !== "rejected")) byDay.set(p.date, p);
  }
  const out: PlanCard[] = [];
  for (const day of eachDay(from, to)) {
    const p = byDay.get(day);
    const live = p && p.status !== "rejected";
    const v = viewOf(data, userId, day, today);
    if (!live && (v.kind !== "working" || v.leave?.half === "none")) continue;
    out.push({
      day,
      plan: p ? { id: p.id, status: p.status as "pending" | "approved" | "rejected", checkIn: hm(p.plannedCheckin) ?? "", checkOut: hm(p.plannedCheckout) ?? "", reason: p.reason, remark: p.approverRemark } : null,
    });
  }
  return out;
}

/** Plans a working day ahead: the check-in and check-out times the person means to keep, sent to the manager (or HR) to approve. */
export async function applyPlan(user: { id: string; name: string }, input: { date: string; checkIn: string; checkOut: string; reason?: string }): Promise<{ id: string }> {
  if (!isDay(input.date)) throw new AttError("Choose the day.");
  const today = istDay();
  const reason = String(input.reason ?? "").trim().slice(0, MAX_REASON);
  const data = await loadDays([user.id], input.date, input.date);
  const v = viewOf(data, user.id, input.date, today);
  const live = await db
    .select({ id: regularizationRequests.id })
    .from(regularizationRequests)
    .where(and(eq(regularizationRequests.userId, user.id), eq(regularizationRequests.date, input.date), eq(regularizationRequests.isFuture, true), inArray(regularizationRequests.status, ["pending", "approved"])));
  const e = planEligibility({ day: input.date, today, kind: v.kind, onFullLeave: v.leave?.half === "none", livePlan: live.length > 0 });
  if (!e.ok) throw new AttError(e.reason);
  const t = checkPlanTimes(input.checkIn, input.checkOut);
  if (!t.ok) throw new AttError(t.error);
  const [checkIn, checkOut] = [formatHm(t.checkInMin), formatHm(t.checkOutMin)];
  const [row] = await db
    .insert(regularizationRequests)
    .values({
      userId: user.id,
      date: input.date,
      missed: "both",
      reason,
      approverId: await approverIdFor(user.id),
      isFuture: true,
      plannedDate: input.date,
      plannedCheckin: checkIn,
      plannedCheckout: checkOut,
    })
    .onConflictDoNothing()
    .returning({ id: regularizationRequests.id, approverId: regularizationRequests.approverId });
  if (!row) throw new AttError("That day is already planned.");
  await notifyNewRequest({ kind: "regularization", id: row.id, requester: user, approverId: row.approverId, summary: `Planned working day ${formatDay(input.date)}: ${checkIn} – ${checkOut}${reason ? `. ${reason}` : ""}` });
  return { id: row.id };
}

// ── Comp-off ──────────────────────────────────────────────────────────────

export type ClaimableDay = { day: string; hours: number };

/** Holidays and weekly offs worked recently that have not been claimed and would not have expired. */
export async function claimableCompoffDays(userId: string): Promise<ClaimableDay[]> {
  const [settings, today] = [await getSettings(), istDay()];
  const from = addDays(today, -settings.compoffExpiryDays);
  const [rows, claimed] = await Promise.all([
    db
      .select({ date: attendance.date, hours: attendance.hoursWorked, out: attendance.checkOutTime })
      .from(attendance)
      .where(and(eq(attendance.userId, userId), eq(attendance.isExtraWork, true), gte(attendance.date, from), lte(attendance.date, today))),
    db.select({ date: compoffRequests.workedDate }).from(compoffRequests).where(and(eq(compoffRequests.userId, userId), inArray(compoffRequests.status, ["pending", "approved", "used"]))),
  ]);
  const done = new Set(claimed.map((c) => c.date));
  return rows
    .filter((r) => r.out && r.hours != null && !done.has(r.date))
    .map((r) => ({ day: r.date, hours: Number(r.hours) }))
    .sort((a, b) => b.day.localeCompare(a.day));
}

export async function applyCompoff(user: { id: string; name: string }, input: { workedDate: string; type: "full" | "half"; reason: string }): Promise<{ id: string }> {
  if (!isDay(input.workedDate)) throw new AttError("Choose the day you worked.");
  const type = input.type === "half" ? "half" : "full";
  const reason = String(input.reason ?? "").trim().slice(0, MAX_REASON);
  const [settings, today, profile, cal] = [await getSettings(), istDay(), await profileOf(user.id), await calendarFor(input.workedDate, input.workedDate)];
  const [rec] = await db.select().from(attendance).where(and(eq(attendance.userId, user.id), eq(attendance.date, input.workedDate)));
  const live = await db
    .select({ id: compoffRequests.id })
    .from(compoffRequests)
    .where(and(eq(compoffRequests.userId, user.id), eq(compoffRequests.workedDate, input.workedDate), inArray(compoffRequests.status, ["pending", "approved", "used"])));
  const error = checkCompoffClaim({
    workedDate: input.workedDate,
    today,
    kind: dayKind(input.workedDate, cal),
    type,
    hoursWorked: rec?.hoursWorked == null ? null : Number(rec.hoursWorked),
    checkedOut: !!rec?.checkOutTime,
    shift: profile.shift,
    expiryDays: settings.compoffExpiryDays,
    alreadyClaimed: live.length > 0,
  });
  if (error) throw new AttError(error);
  const [row] = await db
    .insert(compoffRequests)
    .values({ userId: user.id, workedDate: input.workedDate, compoffType: type, reason, approverId: await approverIdFor(user.id) })
    .onConflictDoNothing()
    .returning({ id: compoffRequests.id, approverId: compoffRequests.approverId });
  if (!row) throw new AttError("You have already claimed a comp-off for that day.");
  await notifyNewRequest({
    kind: "compoff",
    id: row.id,
    requester: user,
    approverId: row.approverId,
    summary: `${compoffDays(type) === 1 ? "Full" : "Half"}-day comp-off for working ${formatDay(input.workedDate)} (expires ${formatDay(expiryFor(input.workedDate, settings.compoffExpiryDays))} if approved)`,
  });
  return { id: row.id };
}

// ── Lists and cancelling ──────────────────────────────────────────────────

export const myWfh = (userId: string) => db.select().from(wfhRequests).where(eq(wfhRequests.userId, userId)).orderBy(desc(wfhRequests.date)).limit(100);
/** The person's corrections and plans, newest day first (a plan has isFuture set). */
export const myRegularizations = (userId: string) => db.select().from(regularizationRequests).where(eq(regularizationRequests.userId, userId)).orderBy(desc(regularizationRequests.date)).limit(100);
export const myCompoffs = (userId: string) => db.select().from(compoffRequests).where(eq(compoffRequests.userId, userId)).orderBy(desc(compoffRequests.workedDate)).limit(100);

/** Withdraws one of the person's own pending WFH, early check-out, regularization or comp-off requests. */
export async function cancelRequest(userId: string, kind: "wfh" | "regularization" | "compoff" | "early", id: string): Promise<void> {
  if (!isUuid(id)) throw new AttError("That request was not found.");
  const table = kind === "wfh" ? wfhRequests : kind === "regularization" ? regularizationRequests : kind === "early" ? earlyDepartures : compoffRequests;
  const done = await db
    .update(table)
    .set({ status: "cancelled" })
    .where(and(eq(table.id, id), eq(table.userId, userId), eq(table.status, "pending")))
    .returning({ id: table.id });
  if (!done.length) throw new AttError("Only a pending request can be withdrawn.");
}
