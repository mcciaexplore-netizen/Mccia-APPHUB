import "server-only";
import { and, eq, gte, inArray, lt, ne, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { aprCategories, aprExpenditureDetails, aprHrCategories, aprHrDetails, aprRequestSteps, aprRequests, type AprRequestType } from "@/db/approvals-schema";

/** Read-only summaries for the report screens. Dates are inclusive "YYYY-MM-DD" in Indian time; drafts never count. */

const istStart = (d: string) => new Date(`${d}T00:00:00+05:30`);
const isDay = (d?: string): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
const inRange = (range: { from?: string; to?: string }): (SQL | undefined)[] => [
  isDay(range.from) ? gte(aprRequests.requestedAt, istStart(range.from)) : undefined,
  isDay(range.to) ? lt(aprRequests.requestedAt, new Date(istStart(range.to).getTime() + 86400000)) : undefined,
];

const sum = (col: typeof aprRequests.amountPaise) => sql<number>`coalesce(sum(${col}), 0)::bigint`.mapWith(Number);
const countWhere = (status: string) => sql<number>`(count(*) filter (where ${aprRequests.status} = ${status}))::int`;

/* ---------------------------------------------------------------- HR */

export type HrReportRow = { name: string; total: number; approved: number; pending: number; rejected: number; amountPaise: number };
export type HrMonthRow = { month: string; total: number; amountPaise: number };

export async function hrReport(range: { from?: string; to?: string }): Promise<{ byCategory: HrReportRow[]; byMonth: HrMonthRow[]; total: number; amountPaise: number }> {
  const where = and(eq(aprRequests.type, "hr"), ne(aprRequests.status, "draft"), ...inRange(range));
  const month = sql<string>`to_char(${aprRequests.requestedAt} at time zone 'Asia/Kolkata', 'YYYY-MM')`;
  const [byCategory, byMonth] = await Promise.all([
    db
      .select({
        name: aprHrCategories.name, total: sql<number>`count(*)::int`, approved: countWhere("approved"), pending: countWhere("pending"), rejected: countWhere("rejected"),
        amountPaise: sum(aprRequests.amountPaise),
      })
      .from(aprRequests)
      .innerJoin(aprHrDetails, eq(aprHrDetails.requestId, aprRequests.id))
      .innerJoin(aprHrCategories, eq(aprHrCategories.id, aprHrDetails.hrCategoryId))
      .where(where)
      .groupBy(aprHrCategories.name)
      .orderBy(sql`count(*) desc`, aprHrCategories.name),
    db
      .select({ month, total: sql<number>`count(*)::int`, amountPaise: sum(aprRequests.amountPaise) })
      .from(aprRequests)
      .where(where)
      .groupBy(month)
      .orderBy(month),
  ]);
  return { byCategory, byMonth, total: byCategory.reduce((a, r) => a + r.total, 0), amountPaise: byCategory.reduce((a, r) => a + r.amountPaise, 0) };
}

/* ---------------------------------------------------------------- turnaround */

export type TurnaroundRow = {
  id: string;
  requestNo: string | null;
  type: AprRequestType;
  categoryName: string | null;
  approverName: string | null;
  status: "approved" | "rejected";
  hours: number;
};
export type TurnaroundGroup = { name: string; count: number; avgHours: number; minHours: number; maxHours: number };

const group = (rows: TurnaroundRow[], key: (r: TurnaroundRow) => string): TurnaroundGroup[] => {
  const map = new Map<string, number[]>();
  for (const r of rows) map.set(key(r), [...(map.get(key(r)) ?? []), r.hours]);
  return [...map.entries()]
    .map(([name, h]) => ({ name, count: h.length, avgHours: h.reduce((a, b) => a + b, 0) / h.length, minHours: Math.min(...h), maxHours: Math.max(...h) }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};

/** How long decided requests took from submission to the decision, overall, by approver and by category. */
export async function turnaround(range: { from?: string; to?: string }, types?: AprRequestType[]): Promise<{ rows: TurnaroundRow[]; byApprover: TurnaroundGroup[]; byCategory: TurnaroundGroup[]; avgHours: number | null }> {
  const rows = await db
    .select({
      id: aprRequests.id, requestNo: aprRequests.requestNo, type: aprRequests.type, status: aprRequests.status,
      categoryName: sql<string | null>`coalesce(${aprHrCategories.name}, ${aprCategories.name})`,
      approverName: sql<string | null>`(select s.approver_name from ${aprRequestSteps} s where s.request_id = ${aprRequests.id} and s.status in ('approved', 'rejected') order by s.step_no desc limit 1)`,
      hours: sql<number>`extract(epoch from (${aprRequests.decidedAt} - ${aprRequests.requestedAt})) / 3600`.mapWith(Number),
    })
    .from(aprRequests)
    .leftJoin(aprHrDetails, eq(aprHrDetails.requestId, aprRequests.id))
    .leftJoin(aprHrCategories, eq(aprHrCategories.id, aprHrDetails.hrCategoryId))
    .leftJoin(aprExpenditureDetails, eq(aprExpenditureDetails.requestId, aprRequests.id))
    .leftJoin(aprCategories, eq(aprCategories.id, aprExpenditureDetails.categoryId))
    .where(and(inArray(aprRequests.status, ["approved", "rejected"]), sql`${aprRequests.decidedAt} is not null`, types?.length ? inArray(aprRequests.type, types) : undefined, ...inRange(range)))
    .orderBy(sql`${aprRequests.decidedAt} desc`)
    .limit(5000);
  const clean = rows.map((r) => ({ ...r, status: r.status as "approved" | "rejected", hours: Math.max(0, r.hours) }));
  return {
    rows: clean,
    byApprover: group(clean, (r) => r.approverName ?? "(unknown)"),
    byCategory: group(clean, (r) => r.categoryName ?? "(none)"),
    avgHours: clean.length ? clean.reduce((a, r) => a + r.hours, 0) / clean.length : null,
  };
}

/** "3.2 h" under a day, "1.4 days" above. */
export function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 24) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}
