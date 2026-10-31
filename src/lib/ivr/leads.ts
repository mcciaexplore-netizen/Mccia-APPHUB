import "server-only";
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { db, rowsOf } from "@/lib/ivr/db";
import {
  callCategories,
  calls,
  emails,
  leadAssignments,
  leadStageEvents,
  leads,
  notes,
  type Outcome,
  type Stage,
} from "@/db/ivr-schema";
import type { SessionUser } from "./dal";
import { isAdminRole } from "./dal";
import { getRetryRule, type RetryRule } from "./settings";
import { hubUsers as users, listIvrAgents } from "./host-adapter";

export type LeadListParams = {
  stage?: Stage;
  categoryId?: string;
  q?: string;
  ownerId?: string; // admin filter, or forced scope for agents
  unassigned?: boolean;
  from?: Date;
  to?: Date;
  page?: number;
  pageSize?: number;
};

export type LeadRow = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  company: string | null;
  memberCode: string | null;
  categoryId: string | null;
  categoryLabel: string | null;
  stage: Stage;
  ownerId: string | null;
  ownerName: string | null;
  attempts: number;
  lastOutcome: Outcome | null;
  lastCallAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lastCallStatus: string | null;
  lastCallDuration: number | null;
  lastCallHasRecording: boolean;
  lastCallId: string | null;
};

const UUID_RE = /^[0-9a-f-]{36}$/i;

/** Agents are forced to their own leads; admins may filter freely. */
export function scopeFor(viewer: SessionUser, requestedOwner?: string): string | undefined {
  return isAdminRole(viewer.role) ? requestedOwner : viewer.id;
}

const rowSelect = {
  id: leads.id,
  name: leads.name,
  phone: leads.phone,
  email: leads.email,
  company: leads.company,
  memberCode: leads.memberCode,
  categoryId: leads.categoryId,
  categoryLabel: callCategories.label,
  stage: leads.stage,
  ownerId: leads.ownerId,
  ownerName: users.name,
  attempts: leads.attempts,
  lastOutcome: leads.lastOutcome,
  lastCallAt: leads.lastCallAt,
  createdAt: leads.createdAt,
  updatedAt: leads.updatedAt,
};

/** Attach the most recent finished call to each lead row. */
async function withLastCalls<T extends { id: string }>(base: T[]): Promise<(T & Pick<LeadRow, "lastCallStatus" | "lastCallDuration" | "lastCallHasRecording" | "lastCallId">)[]> {
  const ids = base.map((b) => b.id);
  const lastCalls = new Map<string, { id: string; status: string; dur: number; rec: boolean }>();
  if (ids.length) {
    const res = await db.execute(sql`
      select distinct on (lead_id) lead_id, id, status, answered_sec as dur, (recording_url is not null) as rec
      from ivr_calls where lead_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) and status <> 'ongoing'
      order by lead_id, started_at desc`);
    for (const r of rowsOf<{ lead_id: string; id: string; status: string; dur: number; rec: boolean }>(res)) {
      lastCalls.set(r.lead_id, { id: r.id, status: r.status, dur: r.dur, rec: r.rec });
    }
  }
  return base.map((b) => {
    const lc = lastCalls.get(b.id);
    return {
      ...b,
      lastCallStatus: lc?.status ?? null,
      lastCallDuration: lc?.dur ?? null,
      lastCallHasRecording: lc?.rec ?? false,
      lastCallId: lc?.id ?? null,
    };
  });
}

export async function listLeads(p: LeadListParams): Promise<{ rows: LeadRow[]; total: number }> {
  const pageSize = Math.min(p.pageSize ?? 25, 200);
  const page = Math.max(p.page ?? 1, 1);
  const conds: (SQL | undefined)[] = [];
  if (p.stage) conds.push(eq(leads.stage, p.stage));
  if (p.categoryId && UUID_RE.test(p.categoryId)) conds.push(eq(leads.categoryId, p.categoryId));
  if (p.unassigned) conds.push(isNull(leads.ownerId));
  else if (p.ownerId) conds.push(eq(leads.ownerId, p.ownerId));
  if (p.q?.trim()) {
    const q = `%${p.q.trim().replace(/[%_]/g, "\\$&")}%`;
    conds.push(or(ilike(leads.name, q), ilike(leads.phone, q), ilike(leads.email, q), ilike(leads.company, q), ilike(leads.memberCode, q)));
  }
  const col = p.stage === "closed" ? leads.updatedAt : leads.createdAt;
  if (p.from) conds.push(gte(col, p.from));
  if (p.to) conds.push(lt(col, p.to));
  const where = and(...conds);

  const [{ n: total }] = await db.select({ n: count() }).from(leads).where(where);
  const base = await db
    .select(rowSelect)
    .from(leads)
    .leftJoin(users, eq(leads.ownerId, users.id))
    .leftJoin(callCategories, eq(leads.categoryId, callCategories.id))
    .where(where)
    .orderBy(desc(leads.updatedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { total, rows: await withLastCalls(base) };
}

export type QueueFilter = "ready" | "waiting" | "exhausted" | "all";

/** 0 = never called, 1 = due for another try, 2 = waiting out the minimum gap, 3 = out of attempts. */
function queueGroup(rule: RetryRule): SQL<number> {
  const gap = `${rule.minGapHours} hours`;
  return sql<number>`(case
    when ${leads.attempts} >= ${rule.maxAttempts} then 3
    when ${leads.attempts} = 0 or ${leads.lastCallAt} is null then 0
    when ${leads.lastCallAt} <= now() - (${gap})::interval then 1
    else 2 end)`;
}

const FILTER_GROUPS: Record<QueueFilter, number[]> = { ready: [0, 1], waiting: [2], exhausted: [3], all: [0, 1, 2, 3] };

export async function queueCounts(ownerId: string, rule?: RetryRule): Promise<Record<QueueFilter, number>> {
  const r = rule ?? (await getRetryRule());
  // Group over a subquery: Postgres cannot match a parameterised CASE in SELECT against the same one in GROUP BY.
  const res = await db.execute(sql`
    select g::int as g, count(*)::int as n from (
      select ${queueGroup(r)} as g from ivr_leads
      where ${leads.ownerId} = ${ownerId}::uuid and ${leads.stage} in ('new', 'attempted')
    ) x group by g`);
  const rows = rowsOf<{ g: number; n: number }>(res);
  const n = (g: number) => rows.find((x) => Number(x.g) === g)?.n ?? 0;
  return { ready: n(0) + n(1), waiting: n(2), exhausted: n(3), all: n(0) + n(1) + n(2) + n(3) };
}

/**
 * An agent's call queue: members still to be reached, never-called first, then the longest-waiting retries.
 * This is automatic ordering, not user scheduling.
 */
export async function listQueue(p: {
  ownerId: string;
  filter: QueueFilter;
  q?: string;
  categoryId?: string;
  page?: number;
  pageSize?: number;
}): Promise<{ rows: LeadRow[]; total: number; rule: RetryRule }> {
  const rule = await getRetryRule();
  const grp = queueGroup(rule);
  const pageSize = Math.min(p.pageSize ?? 25, 200);
  const page = Math.max(p.page ?? 1, 1);
  const conds: (SQL | undefined)[] = [
    eq(leads.ownerId, p.ownerId),
    inArray(leads.stage, ["new", "attempted"]),
    sql`${grp} in (${sql.join(FILTER_GROUPS[p.filter].map((g) => sql`${g}`), sql`, `)})`,
  ];
  if (p.categoryId && UUID_RE.test(p.categoryId)) conds.push(eq(leads.categoryId, p.categoryId));
  if (p.q?.trim()) {
    const q = `%${p.q.trim().replace(/[%_]/g, "\\$&")}%`;
    conds.push(or(ilike(leads.name, q), ilike(leads.phone, q), ilike(leads.company, q), ilike(leads.memberCode, q)));
  }
  const where = and(...conds);
  const [{ n: total }] = await db.select({ n: count() }).from(leads).where(where);
  const base = await db
    .select(rowSelect)
    .from(leads)
    .leftJoin(users, eq(leads.ownerId, users.id))
    .leftJoin(callCategories, eq(leads.categoryId, callCategories.id))
    .where(where)
    .orderBy(asc(grp), asc(sql`coalesce(${leads.lastCallAt}, ${leads.createdAt})`), asc(leads.name))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { total, rows: await withLastCalls(base), rule };
}

/** First member an agent should call right now, or null when the ready queue is empty. */
export async function nextInQueue(ownerId: string): Promise<string | null> {
  const { rows } = await listQueue({ ownerId, filter: "ready", pageSize: 1 });
  return rows[0]?.id ?? null;
}

export async function getLeadDetail(id: string, viewer: SessionUser) {
  if (!UUID_RE.test(id)) return null;
  const [lead] = await db
    .select({
      id: leads.id,
      name: leads.name,
      phone: leads.phone,
      email: leads.email,
      company: leads.company,
      memberCode: leads.memberCode,
      categoryId: leads.categoryId,
      source: leads.source,
      stage: leads.stage,
      attempts: leads.attempts,
      lastOutcome: leads.lastOutcome,
      ownerId: leads.ownerId,
      ownerName: users.name,
      lastCallAt: leads.lastCallAt,
      extra: leads.extra,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .leftJoin(users, eq(leads.ownerId, users.id))
    .where(eq(leads.id, id))
    .limit(1);
  if (!lead) return null;
  if (!isAdminRole(viewer.role) && lead.ownerId !== viewer.id) return null;

  const [callRows, noteRows, emailRows, assignRows, stageRows] = await Promise.all([
    db
      .select({
        id: calls.id,
        direction: calls.direction,
        status: calls.status,
        outcome: calls.outcome,
        startedAt: calls.startedAt,
        durationSec: calls.durationSec,
        answeredSec: calls.answeredSec,
        hasRecording: sql<boolean>`${calls.recordingUrl} is not null`,
        dtmf: calls.dtmf,
        categoryId: calls.categoryId,
        categorySource: calls.categorySource,
        remark: calls.remark,
        agentName: calls.agentName,
        disposition: calls.disposition,
      })
      .from(calls)
      // An agent sees only the calls they handled themselves, even on a member they own.
      .where(and(eq(calls.leadId, id), isAdminRole(viewer.role) ? undefined : eq(calls.agentUserId, viewer.id)))
      .orderBy(desc(calls.startedAt))
      .limit(50),
    db
      .select({ id: notes.id, body: notes.body, createdAt: notes.createdAt, userName: users.name })
      .from(notes)
      .leftJoin(users, eq(notes.userId, users.id))
      .where(eq(notes.leadId, id))
      .orderBy(desc(notes.createdAt)),
    db
      .select({
        id: emails.id,
        subject: emails.subject,
        body: emails.body,
        toAddress: emails.toAddress,
        status: emails.status,
        error: emails.error,
        sentAt: emails.sentAt,
        userName: users.name,
      })
      .from(emails)
      .leftJoin(users, eq(emails.userId, users.id))
      .where(eq(emails.leadId, id))
      .orderBy(desc(emails.sentAt)),
    db
      .select({
        id: leadAssignments.id,
        createdAt: leadAssignments.createdAt,
        reason: leadAssignments.reason,
        toUserId: leadAssignments.toUserId,
        fromUserId: leadAssignments.fromUserId,
      })
      .from(leadAssignments)
      .where(eq(leadAssignments.leadId, id))
      .orderBy(desc(leadAssignments.createdAt)),
    db
      .select()
      .from(leadStageEvents)
      .where(eq(leadStageEvents.leadId, id))
      .orderBy(desc(leadStageEvents.createdAt))
      .limit(20),
  ]);
  return { lead, calls: callRows, notes: noteRows, emails: emailRows, assignments: assignRows, stageEvents: stageRows };
}

export type LeadDetail = NonNullable<Awaited<ReturnType<typeof getLeadDetail>>>;

/** Everyone given the IVR-CRM application (the agents), by name. */
export async function listAgentUsers() {
  return (await listIvrAgents()).map((a) => ({ id: a.id, name: a.name, email: a.email }));
}

/** Agents with how many open members (new or attempted) each carries. */
export async function listAgentWorkload() {
  const agents = await listAgentUsers();
  const rows = await db
    .select({ ownerId: leads.ownerId, n: count() })
    .from(leads)
    .where(inArray(leads.stage, ["new", "attempted"]))
    .groupBy(leads.ownerId);
  return agents.map((a) => ({ id: a.id, name: a.name, open: rows.find((r) => r.ownerId === a.id)?.n ?? 0 }));
}
