import "server-only";
import { and, eq, gte, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/ivr/db";
import {
  calls,
  dialRequests,
  leadAssignments,
  leads,
  leadStageEvents,
  smartfloAgents,
  type Outcome,
  type Stage,
} from "@/db/ivr-schema";
import { categoryForIvrKey, listCategories } from "@/lib/ivr/categories";
import { deriveOutcome } from "@/lib/ivr/outcome";
import { normalizePhone } from "@/lib/ivr/phone";
import { getMembershipLines, lineKey } from "@/lib/ivr/settings";
import { nextStage } from "@/lib/ivr/stage";
import type { SfCall } from "./types";
import { listCallers } from "@/lib/ivr/host-adapter";

const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

type AgentCtx = {
  byAgentId: Map<string, { userId: string | null; id: string }>;
  byNumber: Map<string, string>; // e164 -> user id
  byExt: Map<string, string>; // softphone extension digits -> user id
};

const digitsOf = (n: string | null | undefined): string => (n ?? "").replace(/\D/g, "");

async function loadAgentCtx(): Promise<AgentCtx> {
  const [agents, us] = await Promise.all([
    db.select().from(smartfloAgents),
    listCallers().then((ps) => ps.map((p) => ({ id: p.id, phone: p.phone, smartfloAgentId: p.smartfloAgentId, ext: p.softphoneExtension }))),
  ]);
  const byAgentId = new Map<string, { userId: string | null; id: string }>();
  const byNumber = new Map<string, string>();
  const byExt = new Map<string, string>();
  for (const a of agents) {
    const ext = digitsOf(a.extension);
    if (ext.length >= 3 && a.mappedUserId) byExt.set(ext, a.mappedUserId);
    byAgentId.set(a.id, { userId: a.mappedUserId, id: a.id });
    const n = normalizePhone(a.number);
    if (n && a.mappedUserId) byNumber.set(n, a.mappedUserId);
  }
  for (const u of us) {
    const ext = digitsOf(u.ext);
    if (ext.length >= 3) byExt.set(ext, u.id);
    if (u.smartfloAgentId && !byAgentId.get(u.smartfloAgentId)?.userId) {
      byAgentId.set(u.smartfloAgentId, { userId: u.id, id: u.smartfloAgentId });
    }
    const n = normalizePhone(u.phone);
    if (n && !byNumber.has(n)) byNumber.set(n, u.id);
  }
  return { byAgentId, byNumber, byExt };
}

function resolveAgent(ctx: AgentCtx, c: SfCall): { userId: string | null; agentId: string | null } {
  if (c.agentId && ctx.byAgentId.has(c.agentId)) {
    const hit = ctx.byAgentId.get(c.agentId)!;
    return { userId: hit.userId, agentId: hit.id };
  }
  // Calls taken on a browser softphone report the extension as the agent number.
  const extUid = ctx.byExt.get(digitsOf(c.agentNumber));
  if (extUid) {
    const u = [...ctx.byAgentId.values()].find((a) => a.userId === extUid);
    return { userId: extUid, agentId: u?.id ?? c.agentId };
  }
  const n = normalizePhone(c.agentNumber);
  if (n) {
    const uid = ctx.byNumber.get(n);
    if (uid) {
      const u = [...ctx.byAgentId.values()].find((a) => a.userId === uid);
      return { userId: uid, agentId: u?.id ?? c.agentId };
    }
  }
  return { userId: null, agentId: c.agentId };
}

export type IngestResult = { upserted: number; newLeads: number; skipped: number };

export async function ingestCalls(all: SfCall[], source: "sync" | "webhook" | "click_to_call"): Promise<IngestResult> {
  if (!all.length) return { upserted: 0, newLeads: 0, skipped: 0 };
  const ctx = await loadAgentCtx();

  // The Smartflo account is shared with other departments: keep only Membership calls. A call is Membership's when an agent
  // linked to an IVR-CRM agent handled it or it came in on one of the configured Membership lines. Calls placed from the Call button are ours.
  const lines = new Set((await getMembershipLines()).map(lineKey).filter(Boolean));
  // A call placed from this CRM (the Call button) is Membership's by definition: recognise it by its dial request.
  const ourIds = new Set<string>();
  const ourRefs = new Set<string>();
  if (source !== "click_to_call") {
    const ids = [...new Set(all.map((c) => c.dialRequestId).filter((x): x is string => !!x && /^[0-9a-f-]{32,36}$/i.test(x)))];
    const refs = [...new Set(all.map((c) => c.refId).filter((x): x is string => !!x))];
    for (const part of chunk([...ids, ...refs], 400)) {
      const rows = await db
        .select({ id: dialRequests.id, refId: dialRequests.refId })
        .from(dialRequests)
        .where(or(inArray(dialRequests.id, part.filter((x) => /^[0-9a-f-]{32,36}$/i.test(x))), inArray(dialRequests.refId, part)));
      for (const r of rows) {
        ourIds.add(r.id);
        if (r.refId) ourRefs.add(r.refId);
      }
    }
  }
  const list =
    source === "click_to_call"
      ? all
      : all.filter(
          (c) =>
            !!resolveAgent(ctx, c).userId ||
            (!!c.didNumber && lines.has(lineKey(c.didNumber))) ||
            (!!c.refId && ourRefs.has(c.refId)) ||
            (!!c.dialRequestId && ourIds.has(c.dialRequestId.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5"))),
        );
  const skipped = all.length - list.length;
  if (!list.length) return { upserted: 0, newLeads: 0, skipped };

  // Latest version of each call wins within a batch.
  const dedup = new Map<string, SfCall>();
  for (const c of list) dedup.set(c.callId, c);
  const items = [...dedup.values()]
    .map((c) => ({ c, phone: normalizePhone(c.customerNumber) ?? c.customerNumber.replace(/\s/g, "") }))
    .sort((a, b) => a.c.startedAt.getTime() - b.c.startedAt.getTime());

  // 1. leads by phone, creating missing ones
  const phones = [...new Set(items.map((i) => i.phone))];
  const leadRows = new Map<string, typeof leads.$inferSelect>();
  const loadLeads = async (ps: string[]) => {
    for (const part of chunk(ps, 500)) {
      const rows = await db.select().from(leads).where(inArray(leads.phone, part));
      for (const r of rows) leadRows.set(r.phone, r);
    }
  };
  await loadLeads(phones);
  const missing = phones.filter((p) => !leadRows.has(p));
  if (missing.length) {
    const firstFor = new Map<string, (typeof items)[number]>();
    for (const i of items) if (!firstFor.has(i.phone)) firstFor.set(i.phone, i);
    const newRows = missing.map((p) => {
      const i = firstFor.get(p)!;
      const { userId } = resolveAgent(ctx, i.c);
      return {
        name: i.c.direction === "inbound" ? "Unknown caller" : "Outbound contact",
        phone: p,
        stage: "new" as Stage,
        ownerId: userId,
        source: i.c.direction === "inbound" ? "IVR inbound" : "Outbound call",
      };
    });
    for (const part of chunk(newRows, 300)) {
      await db.insert(leads).values(part).onConflictDoNothing({ target: leads.phone });
    }
    await loadLeads(missing);
  }
  const autoAssigned: (typeof leadAssignments.$inferInsert)[] = [];
  for (const p of missing) {
    const l = leadRows.get(p);
    if (l?.ownerId) autoAssigned.push({ leadId: l.id, fromUserId: null, toUserId: l.ownerId, byUserId: null, reason: "Auto: first call handled by this agent" });
  }

  // 2. dial requests (Call-button presses) tied to these calls, then categories
  const minStart = Math.min(...items.map((i) => i.c.startedAt.getTime()));
  const drIds = [...new Set(items.map((i) => i.c.dialRequestId).filter((x): x is string => !!x))];
  const refIds = [...new Set(items.map((i) => i.c.refId).filter((x): x is string => !!x))];
  const requests: (typeof dialRequests.$inferSelect)[] = [];
  for (const part of chunk([...drIds, ...refIds], 400)) {
    requests.push(
      ...(await db
        .select()
        .from(dialRequests)
        .where(
          and(
            gte(dialRequests.requestedAt, new Date(minStart - 86_400_000)),
            or(inArray(dialRequests.id, part.filter((x) => /^[0-9a-f-]{32,36}$/i.test(x))), inArray(dialRequests.refId, part)),
          ),
        )),
    );
  }
  const requestFor = (c: SfCall) =>
    requests.find((d) => (c.dialRequestId && d.id === c.dialRequestId) || (c.refId && d.refId === c.refId)) ?? null;
  const categories = await listCategories();
  const ivrCategory = new Map<string, string | null>();
  for (const i of items) {
    if (i.c.direction !== "inbound" || !i.c.dtmf) continue;
    if (!ivrCategory.has(i.c.dtmf)) ivrCategory.set(i.c.dtmf, (await categoryForIvrKey(i.c.dtmf))?.id ?? null);
  }
  const validCategory = new Set(categories.map((c) => c.id));

  // 3. upsert calls
  const matchedRequests: { requestId: string; callId: string }[] = [];
  const rows = items.map(({ c, phone }) => {
    const lead = leadRows.get(phone);
    const req = requestFor(c);
    const resolved = resolveAgent(ctx, c);
    const userId = resolved.userId ?? req?.userId ?? null;
    const agentId = resolved.agentId;
    const outcome = deriveOutcome(c.status, c.hangupCause, c.answeredSec);
    let categoryId: string | null = null;
    let categorySource: string | null = null;
    if (c.direction === "inbound" && c.dtmf && ivrCategory.get(c.dtmf)) {
      categoryId = ivrCategory.get(c.dtmf)!;
      categorySource = "ivr";
    } else {
      const cid = req?.categoryId ?? lead?.categoryId ?? null;
      if (cid && validCategory.has(cid)) {
        categoryId = cid;
        categorySource = "lead";
      }
    }
    if (req) matchedRequests.push({ requestId: req.id, callId: c.callId });
    return {
      smartfloCallId: c.callId,
      leadId: lead?.id ?? req?.leadId ?? null,
      outcome,
      categoryId,
      categorySource,
      agentUserId: userId,
      smartfloAgentId: agentId,
      agentName: c.agentName,
      agentNumber: c.agentNumber,
      direction: c.direction,
      status: c.status,
      customerNumber: phone,
      didNumber: c.didNumber,
      startedAt: c.startedAt,
      endedAt: c.endedAt,
      durationSec: c.durationSec,
      answeredSec: c.answeredSec,
      recordingUrl: c.recordingUrl,
      dtmf: c.dtmf,
      disposition: c.disposition,
      hangupCause: c.hangupCause,
      refId: c.refId,
      callFlow: c.callFlow,
      raw: c.raw,
      source,
      updatedAt: new Date(),
    };
  });
  for (const part of chunk(rows, 150)) {
    await db
      .insert(calls)
      .values(part)
      .onConflictDoUpdate({
        target: calls.smartfloCallId,
        set: {
          leadId: sql`coalesce(excluded.lead_id, ${calls.leadId})`,
          agentUserId: sql`coalesce(excluded.agent_user_id, ${calls.agentUserId})`,
          smartfloAgentId: sql`coalesce(excluded.smartflo_agent_id, ${calls.smartfloAgentId})`,
          agentName: sql`coalesce(excluded.agent_name, ${calls.agentName})`,
          agentNumber: sql`coalesce(excluded.agent_number, ${calls.agentNumber})`,
          status: sql`case when excluded.status = 'ongoing' and ${calls.status} <> 'ongoing' then ${calls.status} else excluded.status end`,
          endedAt: sql`coalesce(excluded.ended_at, ${calls.endedAt})`,
          durationSec: sql`greatest(excluded.duration_sec, ${calls.durationSec})`,
          answeredSec: sql`greatest(excluded.answered_sec, ${calls.answeredSec})`,
          recordingUrl: sql`coalesce(excluded.recording_url, ${calls.recordingUrl})`,
          dtmf: sql`coalesce(excluded.dtmf, ${calls.dtmf})`,
          outcome: sql`coalesce(excluded.outcome, ${calls.outcome})`,
          // an agent's choice at wrap-up is never overwritten by a later sync
          categoryId: sql`coalesce(${calls.categoryId}, excluded.category_id)`,
          categorySource: sql`case when ${calls.categoryId} is null then excluded.category_source else ${calls.categorySource} end`,
          disposition: sql`coalesce(excluded.disposition, ${calls.disposition})`,
          hangupCause: sql`coalesce(excluded.hangup_cause, ${calls.hangupCause})`,
          refId: sql`coalesce(excluded.ref_id, ${calls.refId})`,
          callFlow: sql`coalesce(excluded.call_flow, ${calls.callFlow})`,
          raw: sql`excluded.raw`,
          updatedAt: sql`now()`,
        },
      });
  }

  // 4. tie Call-button requests to the calls Smartflo reported
  if (matchedRequests.length) {
    const ids = new Map<string, string>();
    for (const part of chunk([...new Set(matchedRequests.map((m) => m.callId))], 400)) {
      for (const r of await db.select({ id: calls.id, sf: calls.smartfloCallId }).from(calls).where(inArray(calls.smartfloCallId, part))) ids.set(r.sf, r.id);
    }
    await Promise.all(
      matchedRequests.map((m) =>
        db
          .update(dialRequests)
          .set({ status: "matched", resolvedCallId: ids.get(m.callId) ?? null })
          .where(eq(dialRequests.id, m.requestId)),
      ),
    );
  }

  // 5. move leads through the stages (only for calls newer than what we already knew)
  const stageEvents: (typeof leadStageEvents.$inferInsert)[] = [];
  const updates: { id: string; stage: Stage; lastCallAt: Date; ownerId: string | null; attempts: number; lastOutcome: Outcome | null }[] = [];
  const state = new Map<
    string,
    { stage: Stage; lastCallAt: Date | null; ownerId: string | null; attempts: number; lastOutcome: Outcome | null; dirty: boolean }
  >();
  for (const { c, phone } of items) {
    const lead = leadRows.get(phone);
    if (!lead) continue;
    const s =
      state.get(lead.id) ??
      { stage: lead.stage, lastCallAt: lead.lastCallAt, ownerId: lead.ownerId, attempts: lead.attempts, lastOutcome: lead.lastOutcome, dirty: false };
    state.set(lead.id, s);
    if (c.status === "ongoing") continue;
    if (s.lastCallAt && c.startedAt <= s.lastCallAt) continue;
    const outcome = deriveOutcome(c.status, c.hangupCause, c.answeredSec);
    const before = s.stage;
    const next = nextStage(s.stage, { outcome, direction: c.direction });
    s.stage = next;
    s.lastCallAt = c.startedAt;
    s.lastOutcome = outcome;
    if (c.direction === "outbound") s.attempts += 1;
    s.dirty = true;
    if (!s.ownerId) {
      const a = resolveAgent(ctx, c);
      const userId = a.userId ?? requestFor(c)?.userId ?? null;
      if (userId && outcome === "answered") {
        s.ownerId = userId;
        autoAssigned.push({ leadId: lead.id, fromUserId: null, toUserId: userId, byUserId: null, reason: "Auto: answered the call" });
      }
    }
    if (next !== before) stageEvents.push({ leadId: lead.id, fromStage: before, toStage: next, byUserId: null });
  }
  for (const [id, s] of state) {
    if (s.dirty && s.lastCallAt) {
      updates.push({ id, stage: s.stage, lastCallAt: s.lastCallAt, ownerId: s.ownerId, attempts: s.attempts, lastOutcome: s.lastOutcome });
    }
  }
  for (const part of chunk(updates, 25)) {
    await Promise.all(
      part.map((u) =>
        db
          .update(leads)
          .set({
            stage: u.stage,
            lastCallAt: u.lastCallAt,
            ownerId: u.ownerId,
            attempts: u.attempts,
            lastOutcome: u.lastOutcome,
            updatedAt: new Date(),
          })
          .where(eq(leads.id, u.id)),
      ),
    );
  }
  for (const part of chunk(stageEvents, 300)) await db.insert(leadStageEvents).values(part);
  for (const part of chunk(autoAssigned, 300)) await db.insert(leadAssignments).values(part);

  return { upserted: rows.length, newLeads: missing.length, skipped };
}
