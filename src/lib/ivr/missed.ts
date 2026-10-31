import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db, rowsOf } from "@/lib/ivr/db";
import type { Outcome } from "@/db/ivr-schema";

/** Missed inbound calls older than this are history, not a call-back list. */
export const MISSED_DAYS = 30;

export type CallsTab = "all" | "outbound" | "answered" | "missed";
export type MissedSub = "open" | "done";

/**
 * An unanswered inbound call is "connected" once a later call with the same number was answered (either direction, by anyone).
 * A call-back that rings but is not picked up does not count, so the missed call stays in "not connected".
 * Worked out when read, so a missed call moves between the two lists on its own and nothing needs updating.
 */
const RESOLVED = sql`exists (select 1 from ivr_calls r where r.customer_number = c.customer_number and r.status = 'answered' and r.started_at > c.started_at)`;
const IS_MISSED = sql`c.direction = 'inbound' and c.status in ('missed', 'unknown') and c.started_at >= now() - ${sql.raw(`interval '${MISSED_DAYS} days'`)}`;

/** The agent's own calls: only the ones they handled themselves. No user means the whole team (the admin section). */
const scopeOf = (userId?: string): SQL => (userId ? sql`c.agent_user_id = ${userId}::uuid` : sql`true`);

export async function missedCounts(userId?: string): Promise<{ open: number; done: number }> {
  const res = await db.execute(sql`
    select count(*) filter (where not m.resolved)::int as open, count(*) filter (where m.resolved)::int as done
    from (
      select ${RESOLVED} as resolved
      from ivr_calls c left join ivr_leads l on l.id = c.lead_id
      where ${IS_MISSED} and ${scopeOf(userId)}
    ) m`);
  const r = rowsOf<{ open: number; done: number }>(res)[0];
  return { open: Number(r?.open ?? 0), done: Number(r?.done ?? 0) };
}

export type CallListRow = {
  id: string;
  at: Date;
  direction: "inbound" | "outbound";
  status: string;
  outcome: Outcome | null;
  durationSec: number;
  answeredSec: number;
  hasRecording: boolean;
  remark: string | null;
  category: string | null;
  leadId: string | null;
  leadOwnerId: string | null;
  leadStage: string | null;
  name: string | null;
  phone: string;
  /** Unanswered inbound call. */
  missed: boolean;
  /** Missed call that a later answered call has reached. */
  resolved: boolean;
  /** Outbound calls placed to this number after the missed call. */
  tries: number;
  lastTry: Date | null;
};

type Raw = {
  id: string;
  at_ms: string | number;
  direction: string;
  status: string;
  outcome: Outcome | null;
  duration_sec: number;
  answered_sec: number;
  has_recording: boolean;
  remark: string | null;
  category: string | null;
  lead_id: string | null;
  lead_owner: string | null;
  lead_stage: string | null;
  name: string | null;
  phone: string;
  resolved: boolean;
  tries: number;
  last_try_ms: string | number | null;
};

export async function listCalls(p: { userId?: string; tab: CallsTab; sub: MissedSub; limit?: number }): Promise<CallListRow[]> {
  const conds: SQL[] = [scopeOf(p.userId)];
  if (p.tab === "outbound") conds.push(sql`c.direction = 'outbound'`);
  if (p.tab === "answered") conds.push(sql`c.direction = 'inbound' and c.status = 'answered'`);
  if (p.tab === "missed") conds.push(IS_MISSED, p.sub === "done" ? RESOLVED : sql`not ${RESOLVED}`);
  const limit = p.limit ?? (p.tab === "missed" ? 100 : 50);
  const res = await db.execute(sql`
    select c.id, (extract(epoch from c.started_at) * 1000)::bigint as at_ms, c.direction, c.status, c.outcome,
      c.duration_sec, c.answered_sec, (c.recording_url is not null) as has_recording, c.remark, cat.label as category,
      l.id as lead_id, l.owner_id as lead_owner, l.stage as lead_stage, l.name, coalesce(l.phone, c.customer_number) as phone,
      ${RESOLVED} as resolved,
      (select count(*) from ivr_calls r where r.customer_number = c.customer_number and r.direction = 'outbound' and r.status <> 'ongoing' and r.started_at > c.started_at)::int as tries,
      (select (extract(epoch from max(r.started_at)) * 1000)::bigint from ivr_calls r where r.customer_number = c.customer_number and r.direction = 'outbound' and r.status <> 'ongoing' and r.started_at > c.started_at) as last_try_ms
    from ivr_calls c
    left join ivr_leads l on l.id = c.lead_id
    left join ivr_call_categories cat on cat.id = c.category_id
    where ${sql.join(conds, sql` and `)}
    order by c.started_at desc
    limit ${limit}`);
  return rowsOf<Raw>(res).map((r) => {
    const direction = r.direction === "outbound" ? "outbound" : "inbound";
    const missed = direction === "inbound" && (r.status === "missed" || r.status === "unknown");
    return {
      id: r.id,
      at: new Date(Number(r.at_ms)),
      direction,
      status: r.status,
      outcome: r.outcome,
      durationSec: Number(r.duration_sec),
      answeredSec: Number(r.answered_sec),
      hasRecording: !!r.has_recording,
      remark: r.remark,
      category: r.category,
      leadId: r.lead_id,
      leadOwnerId: r.lead_owner,
      leadStage: r.lead_stage,
      name: r.name,
      phone: r.phone,
      missed,
      resolved: missed && !!r.resolved,
      tries: Number(r.tries ?? 0),
      lastTry: r.last_try_ms ? new Date(Number(r.last_try_ms)) : null,
    };
  });
}

/** True when this member has a missed inbound call nobody has reached yet: the Call button becomes "Call back". */
export async function hasOpenMissed(customerNumber: string): Promise<boolean> {
  const res = await db.execute(sql`
    select 1 as x from ivr_calls c
    where c.customer_number = ${customerNumber} and ${IS_MISSED} and not ${RESOLVED}
    limit 1`);
  return rowsOf<{ x: number }>(res).length > 0;
}
