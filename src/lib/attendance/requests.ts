import "server-only";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "./db";
import { attendance, compoffRequests, leaveRequests, regularizationRequests, wfhRequests, type MissedPunch } from "@/db/attendance-schema";
import { AttError } from "./dal";
import { calendarFor, getSettings, profileOf } from "./config";
import { loadDays, recordOf, viewOf } from "./days";
import { dayKind } from "./calendar";
import { regularizationEligibility, checkRegularizationTimes } from "./regularization";
import { checkCompoffClaim, compoffDays, expiryFor } from "./compoff";
import { approverIdFor } from "./leave";
import { notifyNewRequest } from "./notify";
import { MAX_REASON, isUuid } from "./att.manifest";
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

// ── Regularization ────────────────────────────────────────────────────────

export type RegularizableDay = { day: string; missed: MissedPunch[]; checkIn: string | null };

/** The days in the window the person may still regularize (newest first). */
export async function regularizableDays(userId: string): Promise<RegularizableDay[]> {
  const [settings, today] = [await getSettings(), istDay()];
  const from = addDays(today, -settings.regularizationWindowDays);
  const to = addDays(today, -1);
  const [data, live] = await Promise.all([
    loadDays([userId], from, to),
    db
      .select({ date: regularizationRequests.date })
      .from(regularizationRequests)
      .where(and(eq(regularizationRequests.userId, userId), inArray(regularizationRequests.status, ["pending", "approved"]), gte(regularizationRequests.date, from))),
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
    });
    if (e.ok) out.push({ day, missed: e.missed, checkIn: r?.checkInTime ? formatHm(istMinutes(r.checkInTime)) : null });
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
    .where(and(eq(regularizationRequests.userId, user.id), eq(regularizationRequests.date, input.date), inArray(regularizationRequests.status, ["pending", "approved"])));
  const e = regularizationEligibility({
    day: input.date,
    today,
    windowDays: settings.regularizationWindowDays,
    kind: v.kind,
    onFullLeave: v.leave?.half === "none",
    liveRequest: live.length > 0,
    record: r ? { checkIn: !!r.checkInTime, checkOut: !!r.checkOutTime } : null,
  });
  if (!e.ok) throw new AttError(e.reason);
  if (!e.missed.includes(input.missed)) throw new AttError("Choose what was missed on that day.");
  const t = checkRegularizationTimes({ missed: input.missed, checkIn: input.checkIn, checkOut: input.checkOut, recordedCheckInMin: r?.checkInTime ? istMinutes(r.checkInTime) : null });
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
export const myRegularizations = (userId: string) => db.select().from(regularizationRequests).where(eq(regularizationRequests.userId, userId)).orderBy(desc(regularizationRequests.date)).limit(100);
export const myCompoffs = (userId: string) => db.select().from(compoffRequests).where(eq(compoffRequests.userId, userId)).orderBy(desc(compoffRequests.workedDate)).limit(100);

/** Withdraws one of the person's own pending WFH, regularization or comp-off requests. */
export async function cancelRequest(userId: string, kind: "wfh" | "regularization" | "compoff", id: string): Promise<void> {
  if (!isUuid(id)) throw new AttError("That request was not found.");
  const table = kind === "wfh" ? wfhRequests : kind === "regularization" ? regularizationRequests : compoffRequests;
  const done = await db
    .update(table)
    .set({ status: "cancelled" })
    .where(and(eq(table.id, id), eq(table.userId, userId), eq(table.status, "pending")))
    .returning({ id: table.id });
  if (!done.length) throw new AttError("Only a pending request can be withdrawn.");
}
