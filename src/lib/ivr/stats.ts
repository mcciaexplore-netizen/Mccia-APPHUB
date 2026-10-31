import "server-only";
import { and, count, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { db, rowsOf } from "@/lib/ivr/db";
import { leads } from "@/db/ivr-schema";
import { listIvrAgents } from "./host-adapter";
import { istDayStart, addDays } from "./time";
import { missedCounts } from "./missed";
import { cachedLiveCalls, getLiveCalls } from "./smartflo/sync";
import { normalizePhone } from "./phone";

export type Kpis = {
  active: number;
  /** Outbound calls placed in the range. */
  attempted: number;
  /** Calls the member answered, either direction. */
  connected: number;
  /** Share of outbound calls that were answered, or null with no outbound calls. */
  pickupRate: number | null;
  talkSec: number;
  /** Members still to be called (new or attempted). */
  queue: number;
  unassigned?: number;
  /** Missed inbound calls (last 30 days) that nobody has reached yet. */
  missedOpen: number;
};

/** The phone numbers an agent takes calls on: their own number plus the one on their linked Smartflo agent. One query. */
async function agentLines(userId: string): Promise<Set<string | null>> {
  const rows = rowsOf<{ number: string | null }>(
    await db.execute(sql`
      select coalesce(p.phone, u.phone) as number from users u left join ivr_agent_profiles p on p.user_id = u.id where u.id = ${userId}::uuid
      union all
      select number from ivr_smartflo_agents where mapped_user_id = ${userId}::uuid`),
  );
  return new Set(rows.map((r) => normalizePhone(r.number)).filter(Boolean));
}


/**
 * `live: false` is for page renders: "active calls" comes from the last known value instead of waiting on Smartflo,
 * and the KPI strip refreshes it a moment later through /api/kpis (which does ask Smartflo).
 */
export async function getKpis(opts: { userId?: string; from: Date; to: Date; live?: boolean }): Promise<Kpis> {
  // An agent's numbers count only the calls they handled themselves.
  const scope: SQL = opts.userId ? sql`and c.agent_user_id = ${opts.userId}::uuid` : sql``;
  const [callRes, queueRows, unassignedRows, live, mine, missed] = await Promise.all([
    db.execute(sql`
      select
        count(*) filter (where c.direction = 'outbound' and c.status <> 'ongoing')::int as attempted,
        count(*) filter (where c.status = 'answered')::int as connected,
        count(*) filter (where c.direction = 'outbound' and c.status = 'answered')::int as out_answered,
        coalesce(sum(c.answered_sec) filter (where c.status = 'answered'), 0)::int as talk
      from ivr_calls c left join ivr_leads l on l.id = c.lead_id
      where c.started_at >= ${opts.from.toISOString()}::timestamptz and c.started_at < ${opts.to.toISOString()}::timestamptz ${scope}`),
    db
      .select({ n: count() })
      .from(leads)
      .where(and(inArray(leads.stage, ["new", "attempted"]), opts.userId ? eq(leads.ownerId, opts.userId) : undefined)),
    opts.userId ? Promise.resolve([{ n: 0 }]) : db.select({ n: count() }).from(leads).where(isNull(leads.ownerId)),
    opts.live === false ? Promise.resolve(cachedLiveCalls()) : getLiveCalls(),
    opts.userId ? agentLines(opts.userId) : Promise.resolve(null),
    missedCounts(opts.userId),
  ]);
  const c = rowsOf<{ attempted: number; connected: number; out_answered: number; talk: number }>(callRes)[0] ?? {
    attempted: 0,
    connected: 0,
    out_answered: 0,
    talk: 0,
  };

  const active = mine
    ? live.filter((l) => {
        const n = normalizePhone(l.agentNumber);
        return !!n && mine.has(n);
      }).length
    : live.length;

  return {
    active,
    attempted: c.attempted,
    connected: c.connected,
    pickupRate: c.attempted ? Math.round((c.out_answered / c.attempted) * 100) : null,
    talkSec: c.talk,
    queue: queueRows[0]?.n ?? 0,
    unassigned: unassignedRows[0]?.n ?? 0,
    missedOpen: missed.open,
  };
}

export type StageCounts = { new: number; attempted: number; connected: number; closed: number };

export async function getStageCounts(userId?: string): Promise<StageCounts> {
  const rows = await db
    .select({ stage: leads.stage, n: count() })
    .from(leads)
    .where(userId ? eq(leads.ownerId, userId) : undefined)
    .groupBy(leads.stage);
  const g = (s: string) => rows.find((r) => r.stage === s)?.n ?? 0;
  return { new: g("new"), attempted: g("attempted"), connected: g("connected"), closed: g("closed") };
}

export type AgentRow = {
  userId: string;
  name: string;
  assigned: number;
  outbound: number;
  inbound: number;
  answered: number;
  notAnswered: number;
  pickupRate: number | null;
  talkSec: number;
  avgTalkSec: number;
  queue: number;
  connected: number;
  closed: number;
};

/** One row per agent (everyone given IVR-CRM) for a date range. "Assigned" counts members given to the agent in the range. */
export async function getAgentTable(range: { from: Date; to: Date }): Promise<AgentRow[]> {
  const agents = await listIvrAgents();
  if (!agents.length) return [];
  const ids = agents.map((a) => a.id);
  const [callRows, assignedRows, stageRows] = await Promise.all([
    db.execute(sql`
      -- A call counts for the agent who handled it (as in Analytics); a call with no known agent, for the member's owner.
      select coalesce(c.agent_user_id, l.owner_id)::text as uid,
        count(*) filter (where c.direction = 'outbound' and c.status <> 'ongoing')::int as outbound,
        count(*) filter (where c.direction = 'inbound' and c.status <> 'ongoing')::int as inbound,
        count(*) filter (where c.status = 'answered')::int as answered,
        count(*) filter (where c.status in ('missed', 'unknown'))::int as not_answered,
        coalesce(sum(c.answered_sec) filter (where c.status = 'answered'), 0)::int as talk,
        count(*) filter (where c.direction = 'outbound' and c.status = 'answered')::int as out_answered
      from ivr_calls c left join ivr_leads l on l.id = c.lead_id
      where c.started_at >= ${range.from.toISOString()}::timestamptz and c.started_at < ${range.to.toISOString()}::timestamptz
      group by 1`),
    db.execute(sql`
      select to_user_id::text as uid, count(distinct lead_id)::int as n from ivr_lead_assignments
      where created_at >= ${range.from.toISOString()}::timestamptz and created_at < ${range.to.toISOString()}::timestamptz and to_user_id is not null
      group by 1`),
    db
      .select({ uid: leads.ownerId, stage: leads.stage, n: count() })
      .from(leads)
      .where(and(isNotNull(leads.ownerId), inArray(leads.ownerId, ids)))
      .groupBy(leads.ownerId, leads.stage),
  ]);
  const cr = rowsOf<{ uid: string; outbound: number; inbound: number; answered: number; not_answered: number; talk: number; out_answered: number }>(callRows);
  const ar = rowsOf<{ uid: string; n: number }>(assignedRows);
  return agents.map((a) => {
    const m = cr.find((r) => r.uid === a.id);
    const st = (s: string) => stageRows.find((r) => r.uid === a.id && r.stage === s)?.n ?? 0;
    const outbound = m?.outbound ?? 0;
    const answered = m?.answered ?? 0;
    return {
      userId: a.id,
      name: a.name,
      assigned: ar.find((r) => r.uid === a.id)?.n ?? 0,
      outbound,
      inbound: m?.inbound ?? 0,
      answered,
      notAnswered: m?.not_answered ?? 0,
      pickupRate: outbound ? Math.round(((m?.out_answered ?? 0) / outbound) * 100) : null,
      talkSec: m?.talk ?? 0,
      avgTalkSec: answered ? Math.round((m?.talk ?? 0) / answered) : 0,
      queue: st("new") + st("attempted"),
      connected: st("connected"),
      closed: st("closed"),
    };
  });
}

export function todayRange() {
  const from = istDayStart();
  return { from, to: addDays(from, 1) };
}
