import "server-only";
import { sql } from "drizzle-orm";
import { db, rowsOf } from "@/lib/ivr/db";

/** How far back a change can be (a call reaches us when it ends, so its start is at most a few hours back). Keeps the query on an index. */
const LOOKBACK_HOURS = 24;

/**
 * When a call this person can see last changed (null when none in the last day): every call for an admin's team pages, otherwise only
 * the person's own (they handled it, or the member is theirs). Open pages ask every few seconds and refresh when it moves, so a
 * finished call Smartflo sends by webhook shows within seconds instead of at the next minute's sync.
 *
 * Uses the started-at index on ivr_calls, so it reads only the last day's calls however long the history grows.
 */
export async function callsChangedAt(userId: string, team: boolean): Promise<string | null> {
  const mine = team ? sql`true` : sql`(c.agent_user_id = ${userId} or l.owner_id = ${userId})`;
  const res = await db.execute(sql`
    select max(c.updated_at) as at
    from ivr_calls c
    left join ivr_leads l on l.id = c.lead_id
    where c.started_at > now() - make_interval(hours => ${LOOKBACK_HOURS}) and ${mine}`);
  const at = rowsOf<{ at: string | Date | null }>(res)[0]?.at ?? null;
  return at ? new Date(at).toISOString() : null;
}
