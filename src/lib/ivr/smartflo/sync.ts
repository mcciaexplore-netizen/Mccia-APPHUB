import "server-only";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/ivr/db";
import { callEvents, integrations, smartfloAgents } from "@/db/ivr-schema";
import { listCallers, listIvrAgents, saveProfile } from "@/lib/ivr/host-adapter";
import { env } from "@/lib/ivr/env";
import { normalizePhone } from "@/lib/ivr/phone";
import { getAutoSyncConfig, lineKey } from "@/lib/ivr/settings";
import { getSmartflo } from "./index";
import { ingestCalls } from "./ingest";
import { normalizeWebhook } from "./normalize";
import type { SfCall, SfLiveCall } from "./types";

/** Make sure the organisation connection row exists (mock mode has no credentials to store). */
export async function ensureOrgIntegration() {
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.provider, "smartflo_org"), isNull(integrations.userId)))
    .limit(1);
  if (row) return row;
  if (env.smartfloMode !== "mock") return null;
  const [created] = await db
    .insert(integrations)
    .values({ provider: "smartflo_org", status: "connected", meta: { mock: true } })
    .returning();
  return created;
}

async function touchOrg(patch: { lastSyncAt?: Date; lastError?: string | null; status?: string }) {
  const row = await ensureOrgIntegration();
  if (!row) return;
  await db.update(integrations).set({ ...patch, updatedAt: new Date() }).where(eq(integrations.id, row.id));
}

/**
 * Pull the Smartflo agent list (one request) and keep ONLY the Membership agents. The account is shared with other departments,
 * so an agent is stored when it is already known, or matches an IVR-CRM agent (phone, linked id, or a login email only that agent has),
 * or is the one named in `match` (a phone, extension or name typed by the Support Admin). Everyone else is ignored, never stored.
 * Then each kept agent is mapped to an IVR-CRM agent where that is unambiguous.
 */
export async function syncAgents(opts: { match?: string } = {}): Promise<{ agents: number; mapped: number; ignored: number; added: number }> {
  const sf = await getSmartflo();
  const found = await sf.listAgents();
  const now = new Date();
  const [known, crmUsers] = await Promise.all([
    db.select({ id: smartfloAgents.id }).from(smartfloAgents),
    listIvrAgents(),
  ]);
  const knownIds = new Set(known.map((k) => k.id));
  const foundEmails = new Map<string, number>();
  for (const a of found) {
    const e = a.loginId?.toLowerCase();
    if (e) foundEmails.set(e, (foundEmails.get(e) ?? 0) + 1);
  }
  const wanted = opts.match?.trim().toLowerCase() ?? "";
  const wantedDigits = wanted.replace(/\D/g, "");
  const isMembership = (a: (typeof found)[number]) => {
    if (knownIds.has(a.id)) return true;
    const aNum = normalizePhone(a.number);
    const crmHit = crmUsers.some(
      (u) =>
        u.smartfloAgentId === a.id ||
        (aNum && normalizePhone(u.phone) === aNum) ||
        (a.loginId && foundEmails.get(a.loginId.toLowerCase()) === 1 && u.email.toLowerCase() === a.loginId.toLowerCase()),
    );
    if (crmHit) return true;
    if (!wanted) return false;
    return (
      a.id.toLowerCase() === wanted ||
      a.name.toLowerCase() === wanted ||
      (wantedDigits.length >= 3 && [a.extension, a.number].some((n) => (n ?? "").replace(/\D/g, "").endsWith(wantedDigits)))
    );
  };
  const keep = found.filter(isMembership);
  const added = keep.filter((a) => !knownIds.has(a.id)).length;
  if (keep.length) {
    await db
      .insert(smartfloAgents)
      .values(keep.map((a) => ({ id: a.id, name: a.name, number: a.number, extension: a.extension, email: a.loginId, updatedAt: now })))
      .onConflictDoUpdate({
        target: smartfloAgents.id,
        set: {
          name: sql`excluded.name`,
          number: sql`excluded.number`,
          extension: sql`excluded.extension`,
          email: sql`excluded.email`,
          updatedAt: now,
        },
      });
  }
  const ignored = found.length - keep.length;
  const [allAgents, allUsers] = await Promise.all([db.select().from(smartfloAgents), listIvrAgents()]);
  const emailCount = new Map<string, number>();
  for (const a of allAgents) {
    const e = a.email?.toLowerCase();
    if (e) emailCount.set(e, (emailCount.get(e) ?? 0) + 1);
  }
  let mapped = 0;
  for (const a of allAgents) {
    if (a.mappedUserId) {
      mapped++;
      continue;
    }
    const aNum = normalizePhone(a.number);
    const candidates = allUsers.filter(
      (u) =>
        u.smartfloAgentId === a.id ||
        (aNum && normalizePhone(u.phone) === aNum) ||
        // email only when exactly one agent carries it (several agents can share a login email)
        (a.email && emailCount.get(a.email.toLowerCase()) === 1 && u.email.toLowerCase() === a.email.toLowerCase()),
    );
    const taken = new Set(allAgents.filter((x) => x.mappedUserId).map((x) => x.mappedUserId));
    const free = candidates.filter((u) => !taken.has(u.id));
    if (free.length === 1) {
      await db.update(smartfloAgents).set({ mappedUserId: free[0].id }).where(eq(smartfloAgents.id, a.id));
      if (!free[0].smartfloAgentId) await saveProfile(free[0].id, { smartfloAgentId: a.id });
      mapped++;
    }
  }
  return { agents: allAgents.length, mapped, ignored, added };
}

/** Drop stored agents that are not linked to an IVR-CRM agent (other departments' agents). Calls and members are untouched. */
export async function removeUnlinkedAgents(): Promise<number> {
  const gone = await db.delete(smartfloAgents).where(isNull(smartfloAgents.mappedUserId)).returning({ id: smartfloAgents.id });
  return gone.length;
}

async function currentAgentCounts(): Promise<{ agents: number; mapped: number }> {
  const rows = await db.select({ mapped: smartfloAgents.mappedUserId }).from(smartfloAgents);
  return { agents: rows.length, mapped: rows.filter((r) => r.mapped).length };
}

export async function syncCalls(range: { from: Date; to: Date }) {
  const sf = await getSmartflo();
  const list = await sf.listCalls(range);
  return { fetched: list.length, ...(await ingestCalls(list, "sync")) };
}

/**
 * Scheduled reconcile. Re-pulls the last `hours` so webhooks that never arrived are repaired.
 * The agent list is NOT fetched here once Membership agents are linked: it rarely changes and it is a whole-account request.
 */
export async function runSync(opts: { hours?: number } = {}) {
  const hours = opts.hours ?? 48;
  try {
    const linked = await db.select({ id: smartfloAgents.id }).from(smartfloAgents).where(isNotNull(smartfloAgents.mappedUserId)).limit(1);
    const agents = linked.length
      ? await currentAgentCounts()
      : await syncAgents();
    const to = new Date(Date.now() + 3600_000);
    const from = new Date(Date.now() - hours * 3600_000);
    const callsRes = await syncCalls({ from, to });
    await touchOrg({ lastSyncAt: new Date(), lastError: null, status: "connected" });
    return { ok: true as const, agents, calls: callsRes };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    await touchOrg({ lastError: message, status: "error" });
    return { ok: false as const, error: message };
  }
}

// ---- Automatic incremental sync ------------------------------------------------------------------------------------------
// Each run asks Smartflo only for calls since the last successful run (minus an overlap, because a call shows up in the
// records after it ends and may still be updating, e.g. its recording). The window is small, so a run is usually one request.

const OVERLAP_MS = 45 * 60_000;
const FIRST_RUN_HOURS = 48;
const LOCK_MS = 4 * 60_000;

export type TickResult =
  | { ran: true; ok: true; fetched: number; upserted: number; newLeads: number; lastSyncAt: string }
  | { ran: true; ok: false; error: string; lastSyncAt: string | null }
  | { ran: false; reason: "disabled" | "after_hours" | "fresh" | "busy" | "not_connected"; lastSyncAt: string | null };

// Calls already handled by this server instance, so the overlap window is not re-processed every minute. Calls that belong to
// other departments are included: they are fetched every time but cheap to skip. A cold instance simply processes them once.
const seen = globalThis as unknown as { __seenCalls?: Map<string, string>; __lastTickAt?: number; __gapMs?: number; __lastSyncAt?: string };
const signature = (c: SfCall) => `${c.status}|${c.endedAt?.getTime() ?? ""}|${c.durationSec}|${c.answeredSec}|${c.recordingUrl ?? ""}`;

function onlyChanged(list: SfCall[]): SfCall[] {
  const cache = (seen.__seenCalls ??= new Map());
  return list.filter((c) => cache.get(c.callId) !== signature(c));
}

function remember(list: SfCall[]) {
  const cache = (seen.__seenCalls ??= new Map());
  for (const c of list) cache.set(c.callId, signature(c));
  if (cache.size > 5000) for (const k of [...cache.keys()].slice(0, cache.size - 3000)) cache.delete(k);
}

const istHour = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).getUTCHours();

/**
 * Cheap, safe to call as often as you like (every open browser tab does): it returns at once when a sync ran recently, when
 * another instance is already syncing, or outside working hours. `force` skips the freshness and working-hours checks.
 */
export async function runIncrementalSync(opts: { force?: boolean } = {}): Promise<TickResult> {
  // No database round trip at all when this instance has just synced (the common case with many tabs open).
  if (!opts.force && seen.__lastTickAt && Date.now() - seen.__lastTickAt < (seen.__gapMs ?? 60_000)) {
    return { ran: false, reason: "fresh", lastSyncAt: seen.__lastSyncAt ?? null };
  }
  const cfg = await getAutoSyncConfig();
  seen.__gapMs = cfg.minGapSec * 1000;
  const org = await ensureOrgIntegration();
  const lastSyncAt = org?.lastSyncAt?.toISOString() ?? null;
  if (!org || (env.smartfloMode === "live" && !org.encryptedSecret)) return { ran: false, reason: "not_connected", lastSyncAt };
  if (!opts.force) {
    if (!cfg.enabled) return { ran: false, reason: "disabled", lastSyncAt };
    const h = istHour(new Date());
    if (h < cfg.startHour || h >= cfg.endHour) return { ran: false, reason: "after_hours", lastSyncAt };
  }

  // Take the lease and enforce the minimum gap in ONE statement, so tabs and schedulers running at once cannot sync twice.
  const startedAt = new Date();
  const patch = JSON.stringify({ syncLockUntil: new Date(startedAt.getTime() + LOCK_MS).toISOString() });
  const gap = opts.force ? sql`true` : sql`(${integrations.lastSyncAt} is null or ${integrations.lastSyncAt} < now() - make_interval(secs => ${cfg.minGapSec}))`;
  const claimed = await db
    .update(integrations)
    .set({ meta: sql`${integrations.meta} || ${patch}::jsonb` })
    .where(
      and(
        eq(integrations.id, org.id),
        sql`((${integrations.meta}->>'syncLockUntil') is null or (${integrations.meta}->>'syncLockUntil')::timestamptz < now())`,
        gap,
      ),
    )
    .returning({ id: integrations.id });
  if (!claimed.length) {
    const fresh = opts.force ? "busy" : "fresh";
    return { ran: false, reason: fresh, lastSyncAt };
  }
  seen.__lastTickAt = Date.now();

  const release = (extra: Record<string, unknown> = {}) =>
    db
      .update(integrations)
      .set({ meta: sql`${integrations.meta} || ${JSON.stringify({ syncLockUntil: null, ...extra })}::jsonb` })
      .where(eq(integrations.id, org.id));

  try {
    const cursor = typeof org.meta?.syncCursor === "string" ? new Date(org.meta.syncCursor) : null;
    const base = cursor && !Number.isNaN(cursor.getTime()) ? cursor.getTime() - OVERLAP_MS : startedAt.getTime() - FIRST_RUN_HOURS * 3600_000;
    const from = new Date(Math.max(base, startedAt.getTime() - 90 * 24 * 3600_000));
    const to = new Date(startedAt.getTime() + 3600_000);
    const list = await (await getSmartflo()).listCalls({ from, to });
    const changed = onlyChanged(list);
    const res = await ingestCalls(changed, "sync");
    remember(list);
    const done = new Date();
    await db
      .update(integrations)
      .set({
        lastSyncAt: done,
        lastError: null,
        status: "connected",
        updatedAt: done,
        meta: sql`${integrations.meta} || ${JSON.stringify({
          syncLockUntil: null,
          syncCursor: startedAt.toISOString(),
          lastTick: { at: done.toISOString(), fetched: list.length, upserted: res.upserted, newLeads: res.newLeads, ms: done.getTime() - startedAt.getTime() },
        })}::jsonb`,
      })
      .where(eq(integrations.id, org.id));
    seen.__lastSyncAt = done.toISOString();
    return { ran: true, ok: true, fetched: list.length, upserted: res.upserted, newLeads: res.newLeads, lastSyncAt: done.toISOString() };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    // The cursor is not advanced, so the next run covers the same window again.
    await release();
    await touchOrg({ lastError: message, status: "error" });
    return { ran: true, ok: false, error: message, lastSyncAt };
  }
}

/** Store a webhook payload untouched, then merge it into calls when it carries call data. */
export async function processWebhook(payload: Record<string, unknown>) {
  const trigger = String(payload.trigger ?? payload.event ?? payload.$trigger ?? "") || null;
  const callId = String(payload.call_id ?? payload.$call_id ?? "") || null;
  const [ev] = await db.insert(callEvents).values({ trigger, callId, payload }).returning({ id: callEvents.id });
  try {
    const call = normalizeWebhook(payload);
    if (call) await ingestCalls([call], "webhook");
    await db.update(callEvents).set({ processedAt: new Date() }).where(eq(callEvents.id, ev.id));
  } catch (e) {
    await db
      .update(callEvents)
      .set({ error: e instanceof Error ? e.message : "processing failed" })
      .where(eq(callEvents.id, ev.id));
    throw e;
  }
}

// One shared fetch every few seconds serves all open dashboards.
const live = globalThis as unknown as { __live?: { at: number; data: SfLiveCall[]; pending?: Promise<SfLiveCall[]> } };
const LIVE_TTL_MS = 15_000;
const LIVE_WAIT_MS = 1200;

/** Last known live calls with no network call at all. Page renders use this so they never wait on Smartflo. */
export function cachedLiveCalls(): SfLiveCall[] {
  return live.__live?.data ?? [];
}

export async function getLiveCalls(): Promise<SfLiveCall[]> {
  const c = live.__live;
  if (c && Date.now() - c.at < LIVE_TTL_MS) return c.data;
  // "Active calls" is a nice-to-have: never hold a page up for Smartflo. Wait briefly, then fall back to the last known value.
  const soon = (p: Promise<SfLiveCall[]>) =>
    Promise.race([p, new Promise<SfLiveCall[]>((resolve) => setTimeout(() => resolve(live.__live?.data ?? []), LIVE_WAIT_MS))]);
  if (c?.pending) return soon(c.pending);
  const pending = (async () => {
    try {
      const all = await (await getSmartflo()).liveCalls();
      // Only calls on Membership agents' phones (agents linked to IVR-CRM agents); the account is shared with other departments.
      const [mappedAgents, crmUsers] = await Promise.all([
        db.select({ number: smartfloAgents.number, ext: smartfloAgents.extension }).from(smartfloAgents).where(isNotNull(smartfloAgents.mappedUserId)),
        listCallers().then((ps) => ps.map((p) => ({ phone: p.phone, ext: p.softphoneExtension }))),
      ]);
      const mine = new Set(
        [...mappedAgents.flatMap((a) => [lineKey(a.number), lineKey(a.ext)]), ...crmUsers.flatMap((u) => [lineKey(u.phone), lineKey(u.ext)])].filter(Boolean),
      );
      const data = all.filter((l) => mine.has(lineKey(l.agentNumber)));
      live.__live = { at: Date.now(), data };
      return data;
    } catch {
      return live.__live?.data ?? [];
    }
  })();
  live.__live = { at: c?.at ?? 0, data: c?.data ?? [], pending };
  return soon(pending);
}
