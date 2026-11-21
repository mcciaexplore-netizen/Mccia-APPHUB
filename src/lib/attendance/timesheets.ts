import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, rowsOf } from "./db";
import { timeLogs, timeProjects, timesheets, type TimesheetStatus } from "@/db/attendance-schema";
import { AttError } from "./dal";
import { approverIdFor } from "./leave";
import { notifyNewRequest } from "./notify";
import { canEditWeek, checkSubmitWeek, checkTimeEntry } from "./timesheet";
import { isUuid } from "./att.manifest";
import { addDays, formatDay, isDay, istDay, round2, weekStart } from "./time";

/** Time tracking: entries per project and day, and the weekly timesheet that locks them once submitted (rules in timesheet.ts). */

export const activeProjects = () => db.select().from(timeProjects).where(eq(timeProjects.isActive, true)).orderBy(asc(timeProjects.name));
export const allProjects = () => db.select().from(timeProjects).orderBy(desc(timeProjects.isActive), asc(timeProjects.name));

async function sheetOf(userId: string, start: string) {
  const [s] = await db.select().from(timesheets).where(and(eq(timesheets.userId, userId), eq(timesheets.weekStartDate, start)));
  return s ?? null;
}

export async function weekView(userId: string, start: string) {
  const [sheet, logs] = await Promise.all([
    sheetOf(userId, start),
    db
      .select({ id: timeLogs.id, projectId: timeLogs.projectId, projectName: timeProjects.name, date: timeLogs.date, hours: timeLogs.hours, description: timeLogs.description })
      .from(timeLogs)
      .innerJoin(timeProjects, eq(timeProjects.id, timeLogs.projectId))
      .where(and(eq(timeLogs.userId, userId), eq(timeLogs.weekStartDate, start)))
      .orderBy(asc(timeLogs.date), asc(timeLogs.createdAt)),
  ]);
  return { sheet, logs: logs.map((l) => ({ ...l, hours: Number(l.hours) })), total: round2(logs.reduce((n, l) => n + Number(l.hours), 0)) };
}

/** Keeps the draft sheet's total in step with the entries (a sheet row is made on the first entry). */
async function touchSheet(userId: string, start: string): Promise<void> {
  await db
    .insert(timesheets)
    .values({ userId, weekStartDate: start })
    .onConflictDoNothing();
  await db.execute(sql`
    update att_timesheets set total_hours = coalesce((select sum(hours) from att_time_logs where user_id = ${userId} and week_start_date = ${start}), 0)
    where user_id = ${userId} and week_start_date = ${start}`);
}

export async function addTimeLog(userId: string, input: { projectId: string; date: string; hours: number; description: string }): Promise<void> {
  if (!isUuid(input.projectId)) throw new AttError("Choose a project.");
  const [p] = await db.select({ active: timeProjects.isActive }).from(timeProjects).where(eq(timeProjects.id, input.projectId));
  if (!p?.active) throw new AttError("That project is no longer open for time.");
  if (!isDay(input.date)) throw new AttError("Choose the date.");
  const start = weekStart(input.date);
  const description = String(input.description ?? "").trim();
  const hours = Number(input.hours);
  const [sheet, other] = await Promise.all([
    sheetOf(userId, start),
    db.execute(sql`select coalesce(sum(hours), 0) as h from att_time_logs where user_id = ${userId} and date = ${input.date}`),
  ]);
  const otherHours = Number(rowsOf<{ h: string }>(other)[0]?.h ?? 0);
  const err = checkTimeEntry({ date: input.date, hours, today: istDay(), otherHoursThatDay: otherHours, status: sheet?.status ?? null, description });
  if (err) throw new AttError(err);
  await db.insert(timeLogs).values({ userId, projectId: input.projectId, date: input.date, hours, description, weekStartDate: start });
  await touchSheet(userId, start);
}

export async function deleteTimeLog(userId: string, id: string): Promise<void> {
  if (!isUuid(id)) throw new AttError("That entry was not found.");
  const [log] = await db.select().from(timeLogs).where(and(eq(timeLogs.id, id), eq(timeLogs.userId, userId)));
  if (!log) throw new AttError("That entry was not found.");
  const sheet = await sheetOf(userId, log.weekStartDate);
  if (!canEditWeek(sheet?.status)) throw new AttError("That week has been submitted and is locked until it is rejected.");
  await db.delete(timeLogs).where(eq(timeLogs.id, id));
  await touchSheet(userId, log.weekStartDate);
}

export async function submitWeek(user: { id: string; name: string }, start: string): Promise<void> {
  if (!isDay(start)) throw new AttError("Choose the week.");
  const { sheet, total } = await weekView(user.id, start);
  const err = checkSubmitWeek({ start, today: istDay(), status: sheet?.status ?? null, totalHours: total });
  if (err) throw new AttError(err);
  await touchSheet(user.id, start);
  const approverId = await approverIdFor(user.id);
  const done = await db
    .update(timesheets)
    .set({ status: "submitted", submittedAt: new Date(), approverId, totalHours: total, decidedBy: null, approvedAt: null, approverRemark: null })
    .where(and(eq(timesheets.userId, user.id), eq(timesheets.weekStartDate, start), sql`${timesheets.status} in ('draft', 'rejected')`))
    .returning({ id: timesheets.id });
  if (!done.length) throw new AttError("That week has just been submitted. Reload the page.");
  await notifyNewRequest({ kind: "timesheet", id: `${done[0].id}:${Date.now()}`, requester: user, approverId, summary: `Week of ${formatDay(start)} – ${formatDay(addDays(start, 6))}: ${total} hours` });
}

export type WeekStatus = { start: string; status: TimesheetStatus; total: number; remark: string | null };
export async function myWeeks(userId: string, limit = 12): Promise<WeekStatus[]> {
  const rows = await db.select().from(timesheets).where(eq(timesheets.userId, userId)).orderBy(desc(timesheets.weekStartDate)).limit(limit);
  return rows.map((r) => ({ start: r.weekStartDate, status: r.status, total: Number(r.totalHours), remark: r.approverRemark }));
}
