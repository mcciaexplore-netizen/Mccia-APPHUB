import "server-only";
import { and, count, desc, eq, gte, lt, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { activityLog, apps, departments, users } from "@/db/schema";

const IST_MS = 5.5 * 3600 * 1000;
const DAY = 86400000;

/** Start of the current IST day, as a UTC instant. */
function istDayStart(now = Date.now()) {
  return new Date(Math.floor((now + IST_MS) / DAY) * DAY - IST_MS);
}
const istDate = (s: string, endOfDay = false) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]) - IST_MS;
  return new Date(endOfDay ? t + DAY : t);
};

export type Filters = { range: string; from?: string; to?: string; userId?: string; departmentId?: string; appId?: string; action?: "login" | "launch"; page: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseFilters(sp: Record<string, string | string[] | undefined>): Filters {
  const g = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const id = (k: string) => { const v = g(k); return v && UUID.test(v) ? v : undefined; };
  const range = ["today", "7d", "30d", "custom"].includes(g("range") ?? "") ? g("range")! : "7d";
  const action = g("action") === "login" || g("action") === "launch" ? (g("action") as "login" | "launch") : undefined;
  return { range, from: g("from"), to: g("to"), userId: id("user"), departmentId: id("dept"), appId: id("app"), action, page: Math.max(1, Number(g("page")) || 1) };
}

/** [start, end) window as UTC instants. */
function rangeWindow(f: Filters): { start: Date; end: Date } {
  const today = istDayStart();
  const end = new Date(today.getTime() + DAY);
  if (f.range === "today") return { start: today, end };
  if (f.range === "30d") return { start: new Date(today.getTime() - 29 * DAY), end };
  if (f.range === "custom") {
    const s = f.from ? istDate(f.from) : null;
    const e = f.to ? istDate(f.to, true) : null;
    return { start: s ?? new Date(today.getTime() - 6 * DAY), end: e ?? end };
  }
  return { start: new Date(today.getTime() - 6 * DAY), end };
}

function where(f: Filters, scopeDeptId?: string): SQL | undefined {
  const { start, end } = rangeWindow(f);
  const c: SQL[] = [gte(activityLog.openedAt, start), lt(activityLog.openedAt, end)];
  if (scopeDeptId) c.push(eq(activityLog.departmentId, scopeDeptId));
  else if (f.departmentId) c.push(eq(activityLog.departmentId, f.departmentId));
  if (f.userId) c.push(eq(activityLog.userId, f.userId));
  if (f.appId) c.push(eq(activityLog.appId, f.appId));
  if (f.action) c.push(eq(activityLog.action, f.action));
  return and(...c);
}

const PAGE = 50;

export async function getActivity(f: Filters, scopeDeptId?: string) {
  const w = where(f, scopeDeptId);
  const [rows, [{ total }], perApp, perDept] = await Promise.all([
    listRows(f, scopeDeptId, PAGE, (f.page - 1) * PAGE),
    db.select({ total: count() }).from(activityLog).where(w),
    db.select({ name: apps.name, n: count() }).from(activityLog).leftJoin(apps, eq(apps.id, activityLog.appId)).where(and(w, eq(activityLog.action, "launch"))).groupBy(activityLog.appId, apps.name).orderBy(desc(count())).limit(50),
    db.select({ name: departments.name, n: count() }).from(activityLog).innerJoin(departments, eq(departments.id, activityLog.departmentId)).where(and(w, eq(activityLog.action, "launch"))).groupBy(departments.id, departments.name).orderBy(desc(count())).limit(50),
  ]);
  return { rows, total, perApp, perDept, pages: Math.max(1, Math.ceil(total / PAGE)) };
}

export function listRows(f: Filters, scopeDeptId: string | undefined, limit: number, offset: number) {
  return db
    .select({ id: activityLog.id, user: users.name, email: users.email, action: activityLog.action, app: apps.name, department: departments.name, ip: activityLog.ipAddress, openedAt: activityLog.openedAt })
    .from(activityLog)
    .leftJoin(users, eq(users.id, activityLog.userId))
    .leftJoin(apps, eq(apps.id, activityLog.appId))
    .leftJoin(departments, eq(departments.id, activityLog.departmentId))
    .where(where(f, scopeDeptId))
    .orderBy(desc(activityLog.openedAt), desc(activityLog.id))
    .limit(limit).offset(offset);
}

export async function getMetrics(scopeDeptId?: string) {
  const today = istDayStart();
  const weekStart = new Date(today.getTime() - 6 * DAY);
  const scope = scopeDeptId ? eq(activityLog.departmentId, scopeDeptId) : undefined;
  const [[t], [w], top] = await Promise.all([
    db.select({ opens: count() }).from(activityLog).where(and(gte(activityLog.openedAt, today), eq(activityLog.action, "launch"), scope)),
    db.select({ opens: count() }).from(activityLog).where(and(gte(activityLog.openedAt, weekStart), eq(activityLog.action, "launch"), scope)),
    db.select({ name: apps.name, n: count() }).from(activityLog).innerJoin(apps, eq(apps.id, activityLog.appId))
      .where(and(gte(activityLog.openedAt, weekStart), eq(activityLog.action, "launch"), scope)).groupBy(apps.id, apps.name).orderBy(desc(count())).limit(1),
  ]);
  return { launchesToday: t.opens, launchesWeek: w.opens, topApp: top[0] ?? null };
}
