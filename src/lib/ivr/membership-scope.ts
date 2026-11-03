import { sql, type SQL } from "drizzle-orm";

/**
 * The Smartflo account is shared with other departments. Calls are filtered on the way in (src/lib/ivr/smartflo/ingest.ts), but only once
 * the Membership lines are set (Integrations → Membership scope): calls stored before that include other departments'. So every count and
 * list also keeps to Membership when it reads, with these SQL conditions:
 *
 *   a call is Membership's when it came in on one of the lines (its DID, compared on the last 10 digits), an IVR-CRM agent handled it, or
 *   it was placed from the CRM's Call button;
 *   a member is Membership's when it was imported or added by hand, or it has at least one Membership call (members made from a call
 *   that turned out to be another department's drop out).
 *
 * With no lines set, both are true for everything (the behaviour before lines are set). The lines are read in the same statement, so a
 * change in Integrations shows at once and the queries stay one round trip each.
 */

/** The Membership lines' last 10 digits, from ivr_settings (blank entries ignored). */
const LINE_KEYS = sql`(
  select right(regexp_replace(x, '[^0-9]', '', 'g'), 10)
  from ivr_settings s
  cross join lateral jsonb_array_elements_text(case when jsonb_typeof(s.value) = 'array' then s.value else '[]'::jsonb end) as x
  where s.key = 'membership_lines' and regexp_replace(x, '[^0-9]', '', 'g') <> ''
)`;

/** Members made by the call import (ingest.ts), as opposed to imported from a file or added by hand. */
const CALL_MADE_SOURCES = sql`('IVR inbound', 'Outbound call')`;

/** True for a Membership call. `alias` is the ivr_calls alias in the query (c, r, x ...). */
export const membershipCall = (alias: string): SQL => {
  const a = sql.raw(alias);
  return sql`(not exists ${LINE_KEYS}
    or ${a}.agent_user_id is not null
    or ${a}.source = 'click_to_call'
    or right(regexp_replace(coalesce(${a}.did_number, ''), '[^0-9]', '', 'g'), 10) in ${LINE_KEYS})`;
};

/** True for a Membership member. `alias` is the ivr_leads alias in the query (l ...); use "ivr_leads" in a query builder on that table. */
export const membershipLead = (alias: string): SQL => {
  const l = sql.raw(alias);
  return sql`(not exists ${LINE_KEYS}
    or ${l}.source is null
    or ${l}.source not in ${CALL_MADE_SOURCES}
    or exists (select 1 from ivr_calls mc where mc.lead_id = ${l}.id and ${membershipCall("mc")}))`;
};
