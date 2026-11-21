import "server-only";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "./db";
import { attendance, leaveRequests, leaveTypes, wfhRequests, type AttendanceRow } from "@/db/attendance-schema";
import { calendarFor, getSettings } from "./config";
import { effectiveGoLive } from "./settings";
import { resolveDay, type Calendar, type DayView, type PunchRecord } from "./calendar";
import { eachDay, istDay } from "./time";

/**
 * What each day was for each person: punches, approved leave and approved WFH over a range, resolved with the calendar (calendar.ts).
 * Used by Home (schedule, team), the attendance summary, HR's Today and Attendance pages, and the monthly report.
 */

export type DayData = { cal: Calendar; goLive: string; records: Map<string, AttendanceRow>; leaves: Map<string, NonNullable<DayView["leave"]>>; wfh: Set<string> };

const k = (userId: string, day: string) => `${userId}|${day}`;

export const toPunch = (r: AttendanceRow): PunchRecord => ({
  checkIn: r.checkInTime,
  checkOut: r.checkOutTime,
  status: r.status,
  isWfh: r.isWfh,
  isExtraWork: r.isExtraWork,
  isLate: r.isLate,
  isEarlyOut: r.isEarlyOut,
  hoursWorked: r.hoursWorked == null ? null : Number(r.hoursWorked),
  deficitHours: r.deficitHours == null ? null : Number(r.deficitHours),
  excessHours: r.excessHours == null ? null : Number(r.excessHours),
});

/** Everything recorded for these people from `from` to `to`, keyed "userId|day". */
export async function loadDays(userIds: string[], from: string, to: string): Promise<DayData> {
  const goLive = effectiveGoLive(await getSettings(), istDay());
  if (!userIds.length) return { cal: await calendarFor(from, to), goLive, records: new Map(), leaves: new Map(), wfh: new Set() };
  const [cal, recs, leaves, wfh] = await Promise.all([
    calendarFor(from, to),
    db.select().from(attendance).where(and(inArray(attendance.userId, userIds), gte(attendance.date, from), lte(attendance.date, to))),
    db
      .select({ userId: leaveRequests.userId, start: leaveRequests.startDate, end: leaveRequests.endDate, half: leaveRequests.halfDay, typeName: leaveTypes.name, color: leaveTypes.color })
      .from(leaveRequests)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(and(inArray(leaveRequests.userId, userIds), eq(leaveRequests.status, "approved"), lte(leaveRequests.startDate, to), gte(leaveRequests.endDate, from))),
    db
      .select({ userId: wfhRequests.userId, date: wfhRequests.date })
      .from(wfhRequests)
      .where(and(inArray(wfhRequests.userId, userIds), eq(wfhRequests.status, "approved"), gte(wfhRequests.date, from), lte(wfhRequests.date, to))),
  ]);
  const leaveMap = new Map<string, NonNullable<DayView["leave"]>>();
  for (const l of leaves) {
    for (const d of eachDay(l.start < from ? from : l.start, l.end > to ? to : l.end)) leaveMap.set(k(l.userId, d), { half: l.half, typeName: l.typeName, color: l.color });
  }
  return { cal, goLive, records: new Map(recs.map((r) => [k(r.userId, r.date), r])), leaves: leaveMap, wfh: new Set(wfh.map((w) => k(w.userId, w.date))) };
}

/** One person's day from loaded data. */
export function viewOf(data: DayData, userId: string, day: string, today = istDay()): DayView {
  const r = data.records.get(k(userId, day));
  return resolveDay({ day, today, cal: data.cal, record: r ? toPunch(r) : null, leave: data.leaves.get(k(userId, day)) ?? null, wfhApproved: data.wfh.has(k(userId, day)), goLive: data.goLive });
}

export const recordOf = (data: DayData, userId: string, day: string) => data.records.get(k(userId, day)) ?? null;

/** One person's days over a range. */
export async function personDays(userId: string, from: string, to: string): Promise<{ views: DayView[]; data: DayData }> {
  const data = await loadDays([userId], from, to);
  const today = istDay();
  return { views: eachDay(from, to).map((d) => viewOf(data, userId, d, today)), data };
}
