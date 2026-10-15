import "server-only";
import { and, count, desc, eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { accessAudit } from "@/db/schema";
import { scrub } from "@/lib/scrub";

type AuditTarget = "user" | "app" | "branch" | "team" | "import" | "template" | "system";
export type AuditEntry = { action: string; targetType: AuditTarget; targetId?: string | null; targetLabel?: string; details?: Record<string, unknown> };
export type AuditActor = { id: string; name: string };

/** Records who did what. One row per entry, written in as few statements as possible. Throws if the record could not be saved. */
export async function writeAudit(actor: AuditActor, entries: AuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const rows = entries.map((e) => ({
    actorId: actor.id, actorName: actor.name, action: e.action, targetType: e.targetType,
    targetId: e.targetId ?? null, targetLabel: (e.targetLabel ?? "").slice(0, 200), details: scrub(e.details ?? {}) as Record<string, unknown>,
  }));
  for (let i = 0; i < rows.length; i += 500) await db.insert(accessAudit).values(rows.slice(i, i + 500));
}

export type AuditFilters = { q?: string; action?: string; targetId?: string; actorId?: string; from?: string; to?: string; page: number };
const AUDIT_PAGE = 50;

const dayStart = (s: string | undefined, end = false) => {
  const m = s && /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]) - 5.5 * 3600 * 1000; // an Indian calendar day
  return new Date(end ? t + 86400000 : t);
};
const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function filterSql(f: AuditFilters): SQL | undefined {
  const c: SQL[] = [];
  if (f.action) c.push(ilike(accessAudit.action, `${f.action.replace(/[\\%_]/g, (x) => `\\${x}`)}%`));
  if (f.targetId) c.push(eq(accessAudit.targetId, f.targetId));
  if (f.actorId) c.push(eq(accessAudit.actorId, f.actorId));
  const from = dayStart(f.from), to = dayStart(f.to, true);
  if (from) c.push(gte(accessAudit.at, from));
  if (to) c.push(lt(accessAudit.at, to));
  if (f.q?.trim()) {
    const q = like(f.q.trim());
    c.push(or(ilike(accessAudit.actorName, q), ilike(accessAudit.targetLabel, q), ilike(accessAudit.action, q))!);
  }
  return c.length ? and(...c) : undefined;
}

export async function listAudit(f: AuditFilters, pageSize = AUDIT_PAGE) {
  const w = filterSql(f);
  const [rows, [{ total }]] = await Promise.all([
    db.select().from(accessAudit).where(w).orderBy(desc(accessAudit.at), desc(accessAudit.id)).limit(pageSize).offset((Math.max(1, f.page) - 1) * pageSize),
    db.select({ total: count() }).from(accessAudit).where(w),
  ]);
  return { rows, total, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** The distinct action names, for the filter dropdown. */
export async function auditActions(): Promise<string[]> {
  const rows = await db.selectDistinct({ a: accessAudit.action }).from(accessAudit).orderBy(sql`1`);
  return rows.map((r) => r.a);
}
