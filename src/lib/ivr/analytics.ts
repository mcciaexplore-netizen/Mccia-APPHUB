import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db, rowsOf } from "@/lib/ivr/db";
import { addDays, toIstDateString } from "./time";
import { isIvrAgent } from "./host-adapter";

export type Direction = "inbound" | "outbound";

export type AnalyticsParams = {
  from: Date;
  to: Date; // exclusive
  /** Restrict to these users. Undefined or empty means the whole team. */
  userIds?: string[];
  categoryId?: string;
  direction?: Direction;
};

const UUID_RE = /^[0-9a-f-]{36}$/i;

const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

/**
 * Team analytics (the admin section only): a call belongs to the agent who handled it; calls with no known agent fall back to the owner
 * of the member. Agents never see these numbers.
 */
const OWNER = sql`coalesce(c.agent_user_id, l.owner_id)`;

function idList(ids: string[]): SQL {
  return sql.join(
    ids.filter((i) => UUID_RE.test(i)).map((i) => sql`${i}::uuid`),
    sql`, `,
  );
}

/** `and <expr> in (...)` or nothing for the whole team. */
function scope(expr: SQL, ids?: string[]): SQL {
  const valid = (ids ?? []).filter((i) => UUID_RE.test(i));
  return valid.length ? sql`and ${expr} in (${idList(valid)})` : sql``;
}

/** Date range, finished calls only, plus the agent, category and direction filters. Alias: calls c, leads l. */
function callFilter(p: AnalyticsParams): SQL {
  return sql`c.started_at >= ${ts(p.from)} and c.started_at < ${ts(p.to)} and c.status <> 'ongoing'
    ${scope(OWNER, p.userIds)}
    ${p.categoryId && UUID_RE.test(p.categoryId) ? sql`and c.category_id = ${p.categoryId}::uuid` : sql``}
    ${p.direction ? sql`and c.direction = ${p.direction}` : sql``}`;
}

export type DayPoint = { day: string; answered: number; notAnswered: number };

function dayList(from: Date, to: Date): string[] {
  const out: string[] = [];
  for (let d = from, i = 0; d < to && i < 400; d = addDays(d, 1), i++) out.push(toIstDateString(d));
  return out;
}

export async function callsPerDay(p: AnalyticsParams): Promise<DayPoint[]> {
  const res = await db.execute(sql`
    select to_char((c.started_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') as day,
      count(*) filter (where c.status = 'answered')::int as answered,
      count(*) filter (where c.status <> 'answered')::int as not_answered
    from ivr_calls c left join ivr_leads l on l.id = c.lead_id
    where ${callFilter(p)}
    group by 1`);
  const rows = rowsOf<{ day: string; answered: number; not_answered: number }>(res);
  const map = new Map(dayList(p.from, p.to).map((d) => [d, { day: d, answered: 0, notAnswered: 0 }]));
  for (const r of rows) {
    const pt = map.get(r.day);
    if (pt) {
      pt.answered = r.answered;
      pt.notAnswered = r.not_answered;
    }
  }
  return [...map.values()];
}

export type UserDay = { userId: string; name: string; days: { day: string; answered: number }[] };

/** Answered calls per day for each of the given users, used by the compare view. */
export async function answeredPerDayByUser(p: AnalyticsParams & { userIds: string[] }): Promise<UserDay[]> {
  if (!p.userIds.length) return [];
  const res = await db.execute(sql`
    select ${OWNER}::text as uid,
      to_char((c.started_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') as day, count(*)::int as n
    from ivr_calls c left join ivr_leads l on l.id = c.lead_id
    where ${callFilter(p)} and c.status = 'answered'
    group by 1, 2`);
  const rows = rowsOf<{ uid: string; day: string; n: number }>(res);
  const days = dayList(p.from, p.to);
  const names = await db.execute(sql`select id::text as id, name from users where id in (${idList(p.userIds)})`);
  const nameOf = new Map(rowsOf<{ id: string; name: string }>(names).map((r) => [r.id, r.name]));
  return p.userIds
    .filter((id) => UUID_RE.test(id))
    .map((id) => {
      const mine = new Map(rows.filter((r) => r.uid === id).map((r) => [r.day, r.n]));
      return { userId: id, name: nameOf.get(id) ?? "Agent", days: days.map((day) => ({ day, answered: mine.get(day) ?? 0 })) };
    });
}

export type AgentStat = {
  userId: string;
  name: string;
  outbound: number;
  inbound: number;
  answered: number;
  notAnswered: number;
  total: number;
  /** Answered outbound calls as a share of outbound calls, or null when none were placed. */
  pickupRate: number | null;
  talkSec: number;
  avgTalkSec: number;
  avgRingSec: number;
  membersCalled: number;
  assigned: number;
};

export async function agentStats(p: AnalyticsParams): Promise<AgentStat[]> {
  const [callRes, agentRes, assignedRes] = await Promise.all([
    db.execute(sql`
      select ${OWNER}::text as uid,
        count(*) filter (where c.direction = 'outbound')::int as outbound,
        count(*) filter (where c.direction = 'inbound')::int as inbound,
        count(*) filter (where c.status = 'answered')::int as answered,
        count(*) filter (where c.status <> 'answered')::int as not_answered,
        count(*) filter (where c.direction = 'outbound' and c.status = 'answered')::int as out_answered,
        coalesce(sum(c.answered_sec) filter (where c.status = 'answered'), 0)::int as talk,
        coalesce(round(avg(greatest(c.duration_sec - c.answered_sec, 0)) filter (where c.status = 'answered')), 0)::int as ring,
        count(distinct c.customer_number)::int as members
      from ivr_calls c left join ivr_leads l on l.id = c.lead_id
      where ${callFilter(p)}
      group by 1`),
    db.execute(sql`select id::text as id, name from users where ${isIvrAgent(sql`id`)} ${scope(sql`id`, p.userIds)} order by name`),
    db.execute(sql`
      select to_user_id::text as uid, count(distinct lead_id)::int as n from ivr_lead_assignments
      where created_at >= ${ts(p.from)} and created_at < ${ts(p.to)} and to_user_id is not null
      group by 1`),
  ]);
  const calls = rowsOf<{
    uid: string;
    outbound: number;
    inbound: number;
    answered: number;
    not_answered: number;
    out_answered: number;
    talk: number;
    ring: number;
    members: number;
  }>(callRes);
  const assigned = new Map(rowsOf<{ uid: string; n: number }>(assignedRes).map((r) => [r.uid, r.n]));
  return rowsOf<{ id: string; name: string }>(agentRes).map((a) => {
    const m = calls.find((r) => r.uid === a.id);
    const outbound = m?.outbound ?? 0;
    const answered = m?.answered ?? 0;
    return {
      userId: a.id,
      name: a.name,
      outbound,
      inbound: m?.inbound ?? 0,
      answered,
      notAnswered: m?.not_answered ?? 0,
      total: outbound + (m?.inbound ?? 0),
      pickupRate: outbound ? Math.round(((m?.out_answered ?? 0) / outbound) * 100) : null,
      talkSec: m?.talk ?? 0,
      avgTalkSec: answered ? Math.round((m?.talk ?? 0) / answered) : 0,
      avgRingSec: m?.ring ?? 0,
      membersCalled: m?.members ?? 0,
      assigned: assigned.get(a.id) ?? 0,
    };
  });
}

/** Calls by IST weekday (1 = Monday ... 7 = Sunday) and hour. */
export async function heatmap(p: AnalyticsParams): Promise<number[][]> {
  const res = await db.execute(sql`
    select extract(isodow from (c.started_at at time zone 'Asia/Kolkata'))::int as dow,
           extract(hour from (c.started_at at time zone 'Asia/Kolkata'))::int as hr, count(*)::int as n
    from ivr_calls c left join ivr_leads l on l.id = c.lead_id
    where ${callFilter(p)}
    group by 1, 2`);
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const r of rowsOf<{ dow: number; hr: number; n: number }>(res)) {
    if (r.dow >= 1 && r.dow <= 7 && r.hr >= 0 && r.hr <= 23) grid[r.dow - 1][r.hr] = r.n;
  }
  return grid;
}

export type HourPoint = { hour: number; calls: number; answered: number; rate: number | null };

/** Pick-up rate for each IST hour of the day: when members are most likely to answer. */
export async function answerByHour(p: AnalyticsParams): Promise<HourPoint[]> {
  const res = await db.execute(sql`
    select extract(hour from (c.started_at at time zone 'Asia/Kolkata'))::int as hr,
      count(*)::int as calls, count(*) filter (where c.status = 'answered')::int as answered
    from ivr_calls c left join ivr_leads l on l.id = c.lead_id
    where ${callFilter(p)}
    group by 1`);
  const rows = rowsOf<{ hr: number; calls: number; answered: number }>(res);
  return Array.from({ length: 24 }, (_, hour) => {
    const r = rows.find((x) => x.hr === hour);
    const calls = r?.calls ?? 0;
    const answered = r?.answered ?? 0;
    return { hour, calls, answered, rate: calls ? Math.round((answered / calls) * 100) : null };
  });
}

export type Bucket = { label: string; n: number };

/** How long answered calls lasted. */
export async function durationBuckets(p: AnalyticsParams): Promise<Bucket[]> {
  const res = await db.execute(sql`
    select
      count(*) filter (where c.answered_sec < 30)::int as b1,
      count(*) filter (where c.answered_sec >= 30 and c.answered_sec < 60)::int as b2,
      count(*) filter (where c.answered_sec >= 60 and c.answered_sec < 180)::int as b3,
      count(*) filter (where c.answered_sec >= 180 and c.answered_sec < 600)::int as b4,
      count(*) filter (where c.answered_sec >= 600)::int as b5
    from ivr_calls c left join ivr_leads l on l.id = c.lead_id
    where ${callFilter(p)} and c.status = 'answered'`);
  const r = rowsOf<Record<string, number>>(res)[0] ?? {};
  return [
    { label: "Under 30s", n: r.b1 ?? 0 },
    { label: "30s to 1m", n: r.b2 ?? 0 },
    { label: "1 to 3m", n: r.b3 ?? 0 },
    { label: "3 to 10m", n: r.b4 ?? 0 },
    { label: "Over 10m", n: r.b5 ?? 0 },
  ];
}

export type CategoryStat = {
  label: string;
  calls: number;
  outbound: number;
  inbound: number;
  answered: number;
  rate: number | null;
  talkSec: number;
  avgTalkSec: number;
};

export async function categoryStats(p: AnalyticsParams): Promise<CategoryStat[]> {
  const res = await db.execute(sql`
    select coalesce(cat.label, 'Uncategorised') as label,
      count(*)::int as calls,
      count(*) filter (where c.direction = 'outbound')::int as outbound,
      count(*) filter (where c.direction = 'inbound')::int as inbound,
      count(*) filter (where c.status = 'answered')::int as answered,
      coalesce(sum(c.answered_sec) filter (where c.status = 'answered'), 0)::int as talk
    from ivr_calls c left join ivr_leads l on l.id = c.lead_id left join ivr_call_categories cat on cat.id = c.category_id
    where ${callFilter(p)}
    group by 1 order by 2 desc`);
  return rowsOf<{ label: string; calls: number; outbound: number; inbound: number; answered: number; talk: number }>(res).map((r) => ({
    label: r.label,
    calls: r.calls,
    outbound: r.outbound,
    inbound: r.inbound,
    answered: r.answered,
    rate: r.calls ? Math.round((r.answered / r.calls) * 100) : null,
    talkSec: r.talk,
    avgTalkSec: r.answered ? Math.round(r.talk / r.answered) : 0,
  }));
}

export type NumberRow = {
  number: string;
  member: string;
  attempts: number;
  answered: number;
  rate: number;
  inbound: number;
  outbound: number;
  avgTalkSec: number;
  lastAt: string;
  /** IST hour (0-23) when this number most often answered, or null if it never has. */
  bestHour: number | null;
};

/** Answer rate for every number called in the range: the "who picks up, and when" view. */
export async function numberStats(
  p: AnalyticsParams,
  opts: { limit: number; neverAnswered?: boolean; minAttempts?: number },
): Promise<{ rows: NumberRow[]; truncated: boolean }> {
  const res = await db.execute(sql`
    select c.customer_number as number, coalesce(max(l.name), '') as member,
      count(*)::int as attempts,
      count(*) filter (where c.status = 'answered')::int as answered,
      count(*) filter (where c.direction = 'inbound')::int as inbound,
      count(*) filter (where c.direction = 'outbound')::int as outbound,
      coalesce(round(avg(c.answered_sec) filter (where c.status = 'answered')), 0)::int as avg_talk,
      to_char(max(c.started_at) at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI') as last_at,
      (mode() within group (order by extract(hour from (c.started_at at time zone 'Asia/Kolkata'))::int)
        filter (where c.status = 'answered')) as best_hour
    from ivr_calls c left join ivr_leads l on l.id = c.lead_id
    where ${callFilter(p)}
    group by c.customer_number
    having count(*) >= ${opts.minAttempts ?? 1}
      ${opts.neverAnswered ? sql`and count(*) filter (where c.status = 'answered') = 0` : sql``}
    order by ${opts.neverAnswered ? sql`count(*) desc` : sql`count(*) desc, max(c.started_at) desc`}
    limit ${opts.limit + 1}`);
  const rows = rowsOf<{
    number: string;
    member: string;
    attempts: number;
    answered: number;
    inbound: number;
    outbound: number;
    avg_talk: number;
    last_at: string;
    best_hour: number | string | null;
  }>(res);
  return {
    truncated: rows.length > opts.limit,
    rows: rows.slice(0, opts.limit).map((r) => ({
      number: r.number,
      member: r.member,
      attempts: r.attempts,
      answered: r.answered,
      rate: r.attempts ? Math.round((r.answered / r.attempts) * 100) : 0,
      inbound: r.inbound,
      outbound: r.outbound,
      avgTalkSec: r.avg_talk,
      lastAt: r.last_at,
      bestHour: r.best_hour === null || r.best_hour === undefined ? null : Number(r.best_hour),
    })),
  };
}

export type StageCount = { stage: "new" | "attempted" | "connected" | "closed"; n: number };

/** Current members by stage (not date-limited: it answers "where is the work now"). */
export async function membersByStage(userIds?: string[], categoryId?: string): Promise<StageCount[]> {
  const res = await db.execute(sql`
    select l.stage::text as stage, count(*)::int as n from ivr_leads l
    where true ${scope(sql`l.owner_id`, userIds)}
      ${categoryId && UUID_RE.test(categoryId) ? sql`and l.category_id = ${categoryId}::uuid` : sql``}
    group by 1`);
  const rows = rowsOf<{ stage: StageCount["stage"]; n: number }>(res);
  return (["new", "attempted", "connected", "closed"] as const).map((stage) => ({
    stage,
    n: rows.find((r) => r.stage === stage)?.n ?? 0,
  }));
}

export type FunnelStep = { label: string; n: number };

/** Of the members added in the range: how many were tried, reached, and closed. */
export async function memberFunnel(p: AnalyticsParams): Promise<FunnelStep[]> {
  const res = await db.execute(sql`
    select count(*)::int as added,
      count(*) filter (where l.attempts > 0 or l.last_call_at is not null)::int as attempted,
      count(*) filter (where exists (select 1 from ivr_calls c where c.lead_id = l.id and c.status = 'answered'))::int as connected,
      count(*) filter (where l.stage = 'closed')::int as closed
    from ivr_leads l
    where l.created_at >= ${ts(p.from)} and l.created_at < ${ts(p.to)} ${scope(sql`l.owner_id`, p.userIds)}
      ${p.categoryId && UUID_RE.test(p.categoryId) ? sql`and l.category_id = ${p.categoryId}::uuid` : sql``}`);
  const r = rowsOf<{ added: number; attempted: number; connected: number; closed: number }>(res)[0] ?? {
    added: 0,
    attempted: 0,
    connected: 0,
    closed: 0,
  };
  return [
    { label: "Added", n: r.added },
    { label: "Attempted", n: r.attempted },
    { label: "Connected", n: r.connected },
    { label: "Closed", n: r.closed },
  ];
}

export type AssignmentRow = { userId: string; name: string; received: number; reassignedAway: number };
export type AssignmentSummary = { rows: AssignmentRow[]; totalAssigned: number; totalReassigned: number };

export async function assignmentStats(p: AnalyticsParams): Promise<AssignmentSummary> {
  const res = await db.execute(sql`
    select u.id::text as uid, u.name as name,
      count(a.id) filter (where a.to_user_id = u.id)::int as received,
      count(a.id) filter (where a.from_user_id = u.id and a.to_user_id is distinct from u.id)::int as away
    from users u
    left join ivr_lead_assignments a on (a.to_user_id = u.id or a.from_user_id = u.id)
      and a.created_at >= ${ts(p.from)} and a.created_at < ${ts(p.to)}
    where ${isIvrAgent(sql`u.id`)} ${scope(sql`u.id`, p.userIds)}
    group by u.id, u.name order by u.name`);
  const rows = rowsOf<{ uid: string; name: string; received: number; away: number }>(res).map((r) => ({
    userId: r.uid,
    name: r.name,
    received: r.received,
    reassignedAway: r.away,
  }));
  const tot = await db.execute(sql`
    select count(*) filter (where to_user_id is not null)::int as assigned,
           count(*) filter (where from_user_id is not null)::int as reassigned
    from ivr_lead_assignments a
    where a.created_at >= ${ts(p.from)} and a.created_at < ${ts(p.to)}
      ${scope(sql`coalesce(a.to_user_id, a.from_user_id)`, p.userIds)}`);
  const t = rowsOf<{ assigned: number; reassigned: number }>(tot)[0] ?? { assigned: 0, reassigned: 0 };
  return { rows, totalAssigned: t.assigned, totalReassigned: t.reassigned };
}

export type DirStat = {
  calls: number;
  answered: number;
  notAnswered: number;
  rate: number | null;
  /** Distinct numbers called (outbound) or calling (inbound). */
  members: number;
  membersReached: number;
  talkSec: number;
  avgTalkSec: number;
  medianTalkSec: number;
  avgRingSec: number;
};

export type Summary = { inbound: DirStat; outbound: DirStat; total: DirStat };

const emptyDir = (): DirStat => ({
  calls: 0,
  answered: 0,
  notAnswered: 0,
  rate: null,
  members: 0,
  membersReached: 0,
  talkSec: 0,
  avgTalkSec: 0,
  medianTalkSec: 0,
  avgRingSec: 0,
});

/** Volume and call-time numbers per direction, plus the combined total (distinct members counted across both). */
export async function summary(p: AnalyticsParams): Promise<Summary> {
  const body = sql`
      count(*)::int as calls,
      count(*) filter (where c.status = 'answered')::int as answered,
      count(distinct c.customer_number)::int as members,
      count(distinct c.customer_number) filter (where c.status = 'answered')::int as reached,
      coalesce(sum(c.answered_sec) filter (where c.status = 'answered'), 0)::int as talk,
      coalesce(round((percentile_cont(0.5) within group (order by c.answered_sec) filter (where c.status = 'answered'))::numeric), 0)::int as median,
      coalesce(round(avg(greatest(c.duration_sec - c.answered_sec, 0)) filter (where c.status = 'answered')), 0)::int as ring
    from ivr_calls c left join ivr_leads l on l.id = c.lead_id
    where ${callFilter(p)}`;
  const [byDir, all] = await Promise.all([
    db.execute(sql`select c.direction as direction, ${body} group by c.direction`),
    db.execute(sql`select 'total' as direction, ${body}`),
  ]);
  type R = { direction: string; calls: number; answered: number; members: number; reached: number; talk: number; median: number; ring: number };
  const toDir = (r?: R): DirStat => {
    if (!r) return emptyDir();
    return {
      calls: r.calls,
      answered: r.answered,
      notAnswered: r.calls - r.answered,
      rate: r.calls ? Math.round((r.answered / r.calls) * 100) : null,
      members: r.members,
      membersReached: r.reached,
      talkSec: r.talk,
      avgTalkSec: r.answered ? Math.round(r.talk / r.answered) : 0,
      medianTalkSec: r.median,
      avgRingSec: r.ring,
    };
  };
  const rows = rowsOf<R>(byDir);
  return {
    inbound: toDir(rows.find((r) => r.direction === "inbound")),
    outbound: toDir(rows.find((r) => r.direction === "outbound")),
    total: toDir(rowsOf<R>(all)[0]),
  };
}

export type AnalyticsData = {
  summary: Summary;
  perDay: DayPoint[];
  agents: AgentStat[];
  heatmap: number[][];
  byHour: HourPoint[];
  buckets: Bucket[];
  categories: CategoryStat[];
  numbers: { rows: NumberRow[]; truncated: boolean };
  stages: StageCount[];
  funnel: FunnelStep[];
  assignments: AssignmentSummary;
  compare: UserDay[];
};

/** Everything the analytics page needs, JSON-serialisable. */
export async function getAnalytics(p: AnalyticsParams, compare = false): Promise<AnalyticsData> {
  const [s, perDay, agents, hm, byHour, buckets, categories, numbers, stages, funnel, assignments, cmp] = await Promise.all([
    summary(p),
    callsPerDay(p),
    agentStats(p),
    heatmap(p),
    answerByHour(p),
    durationBuckets(p),
    categoryStats(p),
    numberStats(p, { limit: 25 }),
    membersByStage(p.userIds, p.categoryId),
    memberFunnel(p),
    assignmentStats(p),
    compare && p.userIds?.length === 2 ? answeredPerDayByUser({ ...p, userIds: p.userIds }) : Promise.resolve([]),
  ]);
  return {
    summary: s,
    perDay,
    agents,
    heatmap: hm,
    byHour,
    buckets,
    categories,
    numbers,
    stages,
    funnel,
    assignments,
    compare: cmp,
  };
}

export function isUuid(v: string | undefined | null): v is string {
  return !!v && UUID_RE.test(v);
}

export type CallListRow = {
  startedAt: string;
  customerNumber: string;
  member: string;
  agent: string;
  direction: string;
  outcome: string;
  category: string;
  answeredSec: number;
};

/** Newest first. Fetches one extra row so the caller can tell whether the list was cut off. */
export async function callList(p: AnalyticsParams, limit: number): Promise<{ rows: CallListRow[]; truncated: boolean }> {
  const res = await db.execute(sql`
    select to_char(c.started_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI') as started_at,
      c.customer_number as customer, coalesce(l.name, '') as member, coalesce(u.name, c.agent_name, '') as agent,
      c.direction as direction, coalesce(c.outcome::text, c.status::text) as outcome,
      coalesce(cat.label, '') as category, c.answered_sec as answered_sec
    from ivr_calls c
    left join ivr_leads l on l.id = c.lead_id
    left join users u on u.id = ${OWNER}
    left join ivr_call_categories cat on cat.id = c.category_id
    where ${callFilter(p)}
    order by c.started_at desc limit ${limit + 1}`);
  const rows = rowsOf<{
    started_at: string;
    customer: string;
    member: string;
    agent: string;
    direction: string;
    outcome: string;
    category: string;
    answered_sec: number;
  }>(res);
  return {
    truncated: rows.length > limit,
    rows: rows.slice(0, limit).map((r) => ({
      startedAt: r.started_at,
      customerNumber: r.customer,
      member: r.member,
      agent: r.agent,
      direction: r.direction,
      outcome: r.outcome,
      category: r.category,
      answeredSec: r.answered_sec,
    })),
  };
}
