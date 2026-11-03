import "server-only";
import { and, eq, gte, inArray, lt, notInArray, sql } from "drizzle-orm";
import { db } from "./db";
import { designTypes, tickets, timeEntries, type TicketStatus } from "@/db/design-schema";
import { peopleByIds } from "./host-adapter";
import { capacityData } from "./tickets";
import { workingDays, workloadGrid, type WorkloadRow } from "./capacity";
import { getHolidays, getSchedule } from "./config";
import { addDays, istDate, istMoment, OPEN_STATUSES, STATUS_LABEL, weekdayOf } from "./rules";

/**
 * Numbers for the leads: the team overview's counts, the workload grid, and the reports page (SLA compliance, turnaround by design,
 * revisions by department, hours by designer, tickets by status over time) for a date range, with CSV export.
 */

export type Overview = { open: number; overdue: number; inReview: number; deliveredThisWeek: number; pending: number };

/** The dashboard's numbers: the whole team's, or (with `assigneeId`) one designer's own tickets. */
export async function overview(assigneeId?: string): Promise<Overview> {
  const today = istDate();
  const monday = addDays(today, -weekdayOf(today));
  const [r] = await db
    .select({
      open: sql<number>`count(*) filter (where ${tickets.status} in ('new','assigned','in_progress','waiting_on_requester','in_review'))::int`,
      overdue: sql<number>`count(*) filter (where ${tickets.status} in ('new','assigned','in_progress','waiting_on_requester','in_review') and ${tickets.dueAt} < now())::int`,
      inReview: sql<number>`count(*) filter (where ${tickets.status} = 'in_review')::int`,
      delivered: sql<number>`count(*) filter (where ${tickets.deliveredAt} >= ${istMoment(monday)})::int`,
      pending: sql<number>`count(*) filter (where ${tickets.status} = 'pending_review')::int`,
    })
    .from(tickets)
    .where(assigneeId ? eq(tickets.assigneeId, assigneeId) : undefined);
  return { open: r.open, overdue: r.overdue, inReview: r.inReview, deliveredThisWeek: r.delivered, pending: r.pending };
}

export const WORKLOAD_DAYS = 10;

export async function workload(): Promise<{ rows: WorkloadRow[]; days: string[] }> {
  const c = await capacityData();
  const days = workingDays(c.today, WORKLOAD_DAYS + 6, await getSchedule(), await getHolidays()).slice(0, WORKLOAD_DAYS);
  return { rows: workloadGrid(c.designers, c.open, days, c.today), days };
}

// ── Reports ──────────────────────────────────────────────────────────────────

export type Report = {
  from: string;
  to: string;
  totals: { created: number; delivered: number; onTime: number; revisions: number; hours: number };
  sla: { week: string; rate: number | null; delivered: number }[];
  turnaround: { design: string; hours: number; count: number }[];
  revisionsByDept: { department: string; revisions: number; requests: number }[];
  hoursByDesigner: { name: string; hours: number }[];
  statusOverTime: { week: string; [status: string]: number | string }[];
  statusKeys: string[];
};

/** The Monday (IST) of the week a day is in. */
const weekOf = (day: string) => addDays(day, -weekdayOf(day));

export async function report(from: string, to: string): Promise<Report> {
  const start = istMoment(from);
  const end = istMoment(addDays(to, 1));
  const [created, delivered, types, time] = await Promise.all([
    db.select().from(tickets).where(and(gte(tickets.createdAt, start), lt(tickets.createdAt, end))),
    db.select().from(tickets).where(and(gte(tickets.deliveredAt, start), lt(tickets.deliveredAt, end))),
    db.select({ id: designTypes.id, name: designTypes.name }).from(designTypes),
    db
      .select({ userId: timeEntries.userId, seconds: sql<number>`sum(${timeEntries.seconds})::int` })
      .from(timeEntries)
      .where(and(gte(timeEntries.startedAt, start), lt(timeEntries.startedAt, end)))
      .groupBy(timeEntries.userId),
  ]);
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const onTime = (t: (typeof delivered)[number]) => !!t.deliveredAt && (!t.dueAt || +t.deliveredAt <= +t.dueAt);

  const weeks: string[] = [];
  for (let w = weekOf(from); w <= to; w = addDays(w, 7)) weeks.push(w);

  const sla = weeks.map((w) => {
    const inWeek = delivered.filter((t) => weekOf(istDate(t.deliveredAt!)) === w);
    return { week: w, delivered: inWeek.length, rate: inWeek.length ? Math.round((inWeek.filter(onTime).length / inWeek.length) * 100) : null };
  });

  const turnMap = new Map<string, { total: number; count: number }>();
  for (const t of delivered) {
    const name = typeName.get(t.designTypeId) ?? "Other";
    const hours = (+t.deliveredAt! - +t.createdAt) / 3_600_000;
    const m = turnMap.get(name) ?? { total: 0, count: 0 };
    m.total += hours;
    m.count++;
    turnMap.set(name, m);
  }
  const turnaround = [...turnMap].map(([design, m]) => ({ design, hours: Math.round((m.total / m.count) * 10) / 10, count: m.count })).sort((a, b) => b.hours - a.hours);

  const deptMap = new Map<string, { revisions: number; requests: number }>();
  for (const t of created) {
    const d = t.department || "No department";
    const m = deptMap.get(d) ?? { revisions: 0, requests: 0 };
    if (t.versionNumber > 1) m.revisions++;
    else m.requests++;
    deptMap.set(d, m);
  }
  const revisionsByDept = [...deptMap].map(([department, m]) => ({ department, ...m })).sort((a, b) => b.revisions - a.revisions || b.requests - a.requests);

  const people = await peopleByIds(time.map((t) => t.userId));
  const hoursByDesigner = time.map((t) => ({ name: people.get(t.userId)?.name ?? "Former team member", hours: Math.round((t.seconds / 3600) * 10) / 10 })).sort((a, b) => b.hours - a.hours);

  const groups: Record<string, TicketStatus[]> = {
    "Pending review": ["pending_review"],
    Open: ["new", "assigned", "in_progress", "waiting_on_requester"],
    "In review": ["in_review"],
    Delivered: ["delivered", "closed", "closed_without_approval"],
    Other: ["superseded", "declined"],
  };
  const statusKeys = Object.keys(groups);
  const statusOverTime = weeks.map((w) => {
    const row: { week: string; [k: string]: number | string } = { week: w };
    for (const k of statusKeys) row[k] = created.filter((t) => weekOf(istDate(t.createdAt)) === w && groups[k].includes(t.status)).length;
    return row;
  });

  return {
    from,
    to,
    totals: {
      created: created.filter((t) => t.versionNumber === 1).length,
      delivered: delivered.length,
      onTime: delivered.filter(onTime).length,
      revisions: created.filter((t) => t.versionNumber > 1).length,
      hours: Math.round(hoursByDesigner.reduce((s, h) => s + h.hours, 0) * 10) / 10,
    },
    sla,
    turnaround,
    revisionsByDept,
    hoursByDesigner,
    statusOverTime,
    statusKeys,
  };
}

/** Every ticket made in the range, one row each, for the CSV export. */
export async function reportRows(from: string, to: string) {
  const rows = await db
    .select()
    .from(tickets)
    .where(and(gte(tickets.createdAt, istMoment(from)), lt(tickets.createdAt, istMoment(addDays(to, 1)))))
    .orderBy(tickets.createdAt);
  const [types, people] = await Promise.all([db.select({ id: designTypes.id, name: designTypes.name }).from(designTypes), peopleByIds(rows.flatMap((r) => [r.assigneeId, r.requesterId]))]);
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  return rows.map((t) => ({
    Ticket: t.number,
    Title: t.title,
    Design: typeName.get(t.designTypeId) ?? "",
    Department: t.department ?? "",
    Requester: people.get(t.requesterId)?.name ?? "",
    Designer: t.assigneeId ? (people.get(t.assigneeId)?.name ?? "") : "",
    Priority: t.priority,
    Status: STATUS_LABEL[t.status],
    Created: t.createdAt.toISOString(),
    Due: t.dueAt?.toISOString() ?? "",
    Delivered: t.deliveredAt?.toISOString() ?? "",
    "On time": t.deliveredAt ? (!t.dueAt || +t.deliveredAt <= +t.dueAt ? "yes" : "no") : "",
    Version: t.versionNumber,
    "Hours logged": Math.round((t.timeSpentSeconds / 3600) * 10) / 10,
  }));
}

/** Open tickets per designer, for the team overview. */
export async function openByDesigner(): Promise<{ id: string; name: string; open: number; overdue: number }[]> {
  const rows = await db
    .select({
      id: tickets.assigneeId,
      open: sql<number>`count(*)::int`,
      overdue: sql<number>`count(*) filter (where ${tickets.dueAt} < now())::int`,
    })
    .from(tickets)
    .where(and(inArray(tickets.status, OPEN_STATUSES), notInArray(tickets.status, ["pending_review"] as TicketStatus[]), sql`${tickets.assigneeId} is not null`))
    .groupBy(tickets.assigneeId);
  const people = await peopleByIds(rows.map((r) => r.id));
  return rows.map((r) => ({ id: r.id!, name: people.get(r.id!)?.name ?? "Former team member", open: r.open, overdue: r.overdue })).sort((a, b) => b.open - a.open);
}

