import "server-only";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "./db";
import { timeLogs, timeProjects } from "@/db/attendance-schema";
import { listMembers, peopleByIds } from "./host-adapter";
import { loadDays, personDays, recordOf, viewOf } from "./days";
import { leaveHistory, leaveTracker } from "./admin";
import { STATUS_LABEL } from "./calendar";
import { tally, type MonthLine } from "./summary";
import { placeLabel, placeOfPunch } from "./checkin-rules";
import type { DailyRow } from "./daily";
import { eachDay, istClock, istDay, monthRange } from "./time";

/**
 * The CSV reports (rows of cells; the route turns them into a file with the hub's toCsv). Days after today are not counted.
 *
 * Monthly attendance, per person: working days (Mon-Fri and working Saturdays, less holidays), present, absent, late, early out, leave, WFH,
 * extra-work days (holidays and weekly offs worked) and hours. A half day counts 0.5 present and 0.5 absent (or 0.5 leave with half-day
 * leave). A missed check-out counts absent until regularized. The day-by-day report has a Location column: In Office, or Remote (2.3 km).
 */

export async function monthlyReport(month: string): Promise<MonthLine[]> {
  const { from, to } = monthRange(month);
  const today = istDay();
  const last = to > today ? today : to;
  const members = await listMembers();
  if (last < from) return members.map((m) => ({ userId: m.id, name: m.name, workingDays: 0, present: 0, absent: 0, late: 0, earlyOut: 0, leave: 0, wfh: 0, extraWork: 0, hours: 0, inOffice: 0, remote: 0 }));
  const data = await loadDays(
    members.map((m) => m.id),
    from,
    last,
  );
  const days = eachDay(from, last);
  return members.map((m) => ({ userId: m.id, name: m.name, ...tally(days.map((d) => viewOf(data, m.id, d, today))) }));
}

export const MONTH_HEADER = ["Name", "Working days", "Present", "Absent", "Late", "Early out", "Leave", "WFH", "Extra work days", "Hours", "Checked in at office", "Checked in remote"];
export const monthRows = (lines: MonthLine[]) => [MONTH_HEADER, ...lines.map((l) => [l.name, l.workingDays, l.present, l.absent, l.late, l.earlyOut, l.leave, l.wfh, l.extraWork, l.hours, l.inOffice, l.remote])];

export async function leaveBalanceRows(year: number): Promise<unknown[][]> {
  const { types, rows } = await leaveTracker(year);
  return [["Name", ...types.flatMap((t) => (t.isCompoff ? [`${t.name} balance`] : [`${t.name} entitled`, `${t.name} carried`, `${t.name} adjusted`, `${t.name} booked`, `${t.name} pending`, `${t.name} balance`]))], ...rows.map((r) => [r.name, ...types.flatMap((t) => {
    const b = r.balances[t.id];
    return t.isCompoff ? [b.balance] : [b.entitled, b.carried, b.adjusted, b.booked, b.pending, b.balance];
  })])];
}

export async function leaveHistoryRows(from: string, to: string): Promise<unknown[][]> {
  const rows = await leaveHistory({ from, to }, 5000);
  return [["Name", "Leave type", "From", "To", "Half day", "Days", "Status", "Reason", "Decided by", "Remark", "Applied on"], ...rows.map((r) => [r.person, r.typeName, r.startDate, r.endDate, r.halfDay === "none" ? "" : r.halfDay, r.days, r.status, r.reason, r.decidedBy ?? "", r.remark ?? "", istDay(r.createdAt)])];
}

export async function timeByProjectRows(from: string, to: string): Promise<unknown[][]> {
  const rows = await db
    .select({ project: timeProjects.name, userId: timeLogs.userId, hours: sql<string>`sum(${timeLogs.hours})` })
    .from(timeLogs)
    .innerJoin(timeProjects, eq(timeProjects.id, timeLogs.projectId))
    .where(and(gte(timeLogs.date, from), lte(timeLogs.date, to)))
    .groupBy(timeProjects.name, timeLogs.userId)
    .orderBy(timeProjects.name);
  const people = await peopleByIds(rows.map((r) => r.userId));
  return [["Project", "Name", "Hours"], ...rows.map((r) => [r.project, people.get(r.userId)?.name ?? "Former member", Number(r.hours)])];
}

/** One person's month, day by day (the staff CSV download and HR's Attendance page). */
export async function personMonthRows(userId: string, from: string, to: string): Promise<unknown[][]> {
  const { views, data } = await personDays(userId, from, to);
  return [["Date", "Day status", "Check in", "Check out", "Location", "Check-out location", "Check-in coordinates", "Method", "Hours", "Deficit", "Excess", "Late", "Early out", "WFH", "Extra work", "Leave"], ...views.map((v) => {
    const r = recordOf(data, userId, v.day);
    return [
      v.day,
      v.missedCheckout ? "Absent (missed check-out)" : STATUS_LABEL[v.status],
      r?.checkInTime ? istClock(r.checkInTime) : "",
      r?.checkOutTime ? istClock(r.checkOutTime) : "",
      placeLabel(placeOfPunch(r?.checkInPlace, r?.checkInMethod), r?.checkInDistanceM),
      r?.checkOutTime ? placeLabel(placeOfPunch(r.checkOutPlace, r.checkOutMethod), r.checkOutDistanceM) : "",
      r?.checkInLat != null && r.checkInLng != null ? `${r.checkInLat.toFixed(6)}, ${r.checkInLng.toFixed(6)}` : "",
      r?.checkInMethod ?? "",
      r?.hoursWorked ?? "",
      r?.deficitHours ?? "",
      r?.excessHours ?? "",
      r?.isLate ? "Yes" : "",
      r?.isEarlyOut ? "Yes" : "",
      r?.isWfh ? "Yes" : "",
      r?.isExtraWork ? "Yes" : "",
      v.leave ? `${v.leave.typeName}${v.leave.half !== "none" ? ` (${v.leave.half} half)` : ""}` : "",
    ];
  })];
}

// ── Daily report (the rows' shape and the CSV are in daily.ts) ──────────

/** Everyone who checked in on `day` (members only), by name, with where and when. */
export async function dailyReport(day: string): Promise<DailyRow[]> {
  const members = await listMembers();
  const data = await loadDays(
    members.map((m) => m.id),
    day,
    day,
  );
  const rows: DailyRow[] = [];
  const now = Date.now();
  const today = istDay(now);
  for (const m of members) {
    const r = recordOf(data, m.id, day);
    if (!r?.checkInTime) continue;
    rows.push({
      userId: m.id,
      name: m.name,
      email: m.email,
      checkIn: r.checkInTime.toISOString(),
      checkOut: r.checkOutTime?.toISOString() ?? null,
      place: placeOfPunch(r.checkInPlace, r.checkInMethod),
      area: r.checkInArea,
      distanceM: r.checkInDistanceM,
      hoursWorked: r.hoursWorked == null ? null : Number(r.hoursWorked),
      hoursSoFar: day === today && !r.checkOutTime ? Math.max(0, now - +r.checkInTime) / 3_600_000 : null,
      isLate: r.isLate,
      isEarlyOut: r.isEarlyOut,
      isWfh: r.isWfh,
      regularized: !!r.regularizationId,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export const reportFileName = (what: string, a: string, b?: string) => `attendance-${what}-${a}${b && b !== a ? `-to-${b}` : ""}.csv`;
