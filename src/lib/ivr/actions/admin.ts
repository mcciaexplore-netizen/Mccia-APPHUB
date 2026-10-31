"use server";

import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/ivr/db";
import { integrations, smartfloAgents } from "@/db/ivr-schema";
import { clearSmartfloLink, isAgentNow, saveProfile } from "@/lib/ivr/host-adapter";
import { audit } from "@/lib/ivr/audit";
import { encryptJson } from "@/lib/ivr/crypto";
import { EXTENSION_RE } from "@/lib/ivr/agent-number";
import { assertAdmin, assertSuperAdmin } from "@/lib/ivr/dal";
import { env } from "@/lib/ivr/env";
import { normalizePhone } from "@/lib/ivr/phone";
import { providerFromCredentials } from "@/lib/ivr/smartflo";
import type { SmartfloCredentials } from "@/lib/ivr/smartflo/live";
import { saveAutoSyncConfig, saveMembershipLines } from "@/lib/ivr/settings";
import { removeUnlinkedAgents, runSync, syncAgents } from "@/lib/ivr/smartflo/sync";
import type { ActionResult } from "./leads";

const fail = (e: unknown): ActionResult => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong" });
const zodMsg = (e: z.ZodError) => e.issues[0]?.message ?? "Check the form";

const extension = z.union([z.literal(""), z.string().trim().regex(EXTENSION_RE, "An extension is digits only, for example 060123456.")]).optional();

const profileSchema = z.object({
  phone: z.string().trim().max(30).optional(),
  softphoneExtension: extension,
});

/**
 * An agent's IVR-CRM details: the phone Smartflo rings and their browser softphone extension. People themselves (names, sign-in, who has
 * IVR-CRM) are managed in the hub; this is the only thing about a person IVR-CRM stores.
 */
export async function saveAgentProfile(id: string, input: z.input<typeof profileSchema>): Promise<ActionResult> {
  try {
    const me = await assertAdmin();
    const p = profileSchema.safeParse(input);
    if (!p.success) return { ok: false, error: zodMsg(p.error) };
    if (!(await isAgentNow(id))) return { ok: false, error: "That person is not an IVR-CRM agent (they need the IVR-CRM application)." };
    const phone = p.data.phone ? normalizePhone(p.data.phone) : null;
    if (p.data.phone && !phone) return { ok: false, error: "That phone number is not valid." };
    await saveProfile(id, { phone, softphoneExtension: p.data.softphoneExtension || null });
    await audit(me.id, "agent.profile", id);
    revalidatePath("/ivr/admin/agents");
    return { ok: true, message: "Saved" };
  } catch (e) {
    return fail(e);
  }
}

/** Link a Smartflo agent to an IVR-CRM agent (or unlink with userId = null). One person maps to one Smartflo agent. */
export async function mapAgent(agentId: string, userId: string | null): Promise<ActionResult> {
  try {
    const me = await assertAdmin();
    const [agent] = await db.select().from(smartfloAgents).where(eq(smartfloAgents.id, agentId)).limit(1);
    if (!agent) return { ok: false, error: "Smartflo agent not found." };
    if (userId && !(await isAgentNow(userId))) return { ok: false, error: "That person is not an IVR-CRM agent (they need the IVR-CRM application)." };
    await clearSmartfloLink(agentId);
    if (userId) {
      await db.update(smartfloAgents).set({ mappedUserId: null }).where(and(eq(smartfloAgents.mappedUserId, userId), ne(smartfloAgents.id, agentId)));
      await saveProfile(userId, { smartfloAgentId: agentId });
    }
    await db.update(smartfloAgents).set({ mappedUserId: userId }).where(eq(smartfloAgents.id, agentId));
    await audit(me.id, "ivr.map", agentId, { userId });
    revalidatePath("/ivr/admin/integrations");
    revalidatePath("/ivr/admin/agents");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const connectSchema = z.union([
  z.object({ email: z.string().trim().min(3, "Enter the Smartflo login email"), password: z.string().min(1, "Enter the password") }),
  z.object({ token: z.string().trim().min(10, "Paste the API token") }),
]);

export async function connectSmartflo(input: { email?: string; password?: string; token?: string }): Promise<ActionResult> {
  try {
    const me = await assertSuperAdmin();
    const p = connectSchema.safeParse(input.token ? { token: input.token } : { email: input.email, password: input.password });
    if (!p.success) return { ok: false, error: zodMsg(p.error) };
    const creds = p.data as SmartfloCredentials;
    const test = await providerFromCredentials(creds).testConnection();
    if (!test.ok) return { ok: false, error: test.error };
    const secret = encryptJson(creds);
    const [existing] = await db
      .select({ id: integrations.id })
      .from(integrations)
      .where(and(eq(integrations.provider, "smartflo_org"), isNull(integrations.userId)))
      .limit(1);
    if (existing) {
      await db.update(integrations).set({ encryptedSecret: secret, status: "connected", lastError: null, meta: sql`${integrations.meta} - 'sfToken'`, updatedAt: new Date() }).where(eq(integrations.id, existing.id));
    } else {
      await db.insert(integrations).values({ provider: "smartflo_org", encryptedSecret: secret, status: "connected" });
    }
    await audit(me.id, "smartflo.connect");
    let syncError = "";
    const sync = await syncAgents().catch((e) => {
      syncError = e instanceof Error ? e.message : "unknown error";
      return null;
    });
    revalidatePath("/ivr/admin/integrations");
    revalidatePath("/ivr/admin/agents");
    return {
      ok: true,
      message:
        `Connected. The account has ${test.agents} agents; ${sync ? `${sync.agents} Membership agent${sync.agents === 1 ? " was" : "s were"} kept (${sync.mapped} matched to IVR-CRM agents) and ${sync.ignored} others ignored` : "none saved yet"}. Run a sync to pull call history.` +
        (test.note ? ` ${test.note}` : "") +
        (syncError ? ` Saving the agent list failed: ${syncError}` : ""),
    };
  } catch (e) {
    return fail(e);
  }
}

/** Re-read the agents already kept (new phone number or extension). One Smartflo request; other departments' agents are not stored. */
export async function refreshAgents(): Promise<ActionResult> {
  try {
    const me = await assertSuperAdmin();
    const r = await syncAgents();
    await audit(me.id, "smartflo.agents_refresh");
    revalidatePath("/ivr/admin/integrations");
    revalidatePath("/ivr/admin/agents");
    return { ok: true, message: `Updated ${r.agents} Membership agent${r.agents === 1 ? "" : "s"} (${r.mapped} linked). ${r.ignored} other agents on the account were ignored.` };
  } catch (e) {
    return fail(e);
  }
}

/** Add one Membership agent that is not linked to an IVR-CRM agent yet, found by phone, extension or exact name. Only that agent is stored. */
export async function addMembershipAgent(query: string): Promise<ActionResult> {
  try {
    const me = await assertSuperAdmin();
    const q = query.trim();
    if (q.length < 3) return { ok: false, error: "Enter the agent's phone number, extension or full name." };
    const r = await syncAgents({ match: q });
    if (!r.added) return { ok: false, error: `No new Smartflo agent matches "${q}". It may already be added, or the number or name is different in Smartflo.` };
    await audit(me.id, "smartflo.agent_add", undefined, { added: r.added });
    revalidatePath("/ivr/admin/integrations");
    revalidatePath("/ivr/admin/agents");
    return { ok: true, message: `Added ${r.added} agent. Link it to an IVR-CRM agent under Agents.` };
  } catch (e) {
    return fail(e);
  }
}

/** Remove stored agents that are not linked to anyone (they belong to other departments). Calls and members are untouched. */
export async function removeUnlinkedAgentsAction(): Promise<ActionResult> {
  try {
    const me = await assertSuperAdmin();
    const n = await removeUnlinkedAgents();
    await audit(me.id, "smartflo.agents_prune", undefined, { removed: n });
    revalidatePath("/ivr/admin/integrations");
    revalidatePath("/ivr/admin/agents");
    return { ok: true, message: n ? `Removed ${n} unlinked agent${n === 1 ? "" : "s"}.` : "Nothing to remove: every stored agent is linked." };
  } catch (e) {
    return fail(e);
  }
}

export async function disconnectSmartflo(): Promise<ActionResult> {
  try {
    const me = await assertSuperAdmin();
    await db.delete(integrations).where(and(eq(integrations.provider, "smartflo_org"), isNull(integrations.userId)));
    await audit(me.id, "smartflo.disconnect");
    revalidatePath("/ivr/admin/integrations");
    return { ok: true, message: "Disconnected. Existing calls and leads are kept." };
  } catch (e) {
    return fail(e);
  }
}

export async function syncNow(hours: number): Promise<ActionResult> {
  try {
    const me = await assertSuperAdmin();
    const h = Math.min(Math.max(Math.round(hours) || 48, 1), 24 * 90);
    const r = await runSync({ hours: h });
    await audit(me.id, "smartflo.sync", undefined, { hours: h, ok: r.ok });
    for (const p of ["/ivr/admin/integrations", "/ivr/admin", "/ivr", "/ivr/admin/members"]) revalidatePath(p);
    if (!r.ok) return { ok: false, error: r.error };
    const { fetched, upserted, newLeads, skipped } = r.calls;
    const why =
      fetched === 0
        ? " Smartflo returned no call records for this period. Try a longer period, or check the account has calls in it."
        : upserted === 0
          ? " Nothing was kept: none of those calls was handled by a linked Membership agent or came in on a Membership line. Link the agent under Users and check the Membership phone numbers."
          : "";
    return {
      ok: true,
      message: `Fetched ${fetched} calls: kept ${upserted} for Membership (${newLeads} new members), ignored ${skipped} that belong to other departments. ${r.agents.mapped} of ${r.agents.agents} agents are mapped.${why}`,
    };
  } catch (e) {
    return fail(e);
  }
}

/** The phone lines (DIDs) that belong to Membership. One per line or comma separated. */
export async function saveMembershipLinesAction(text: string): Promise<ActionResult> {
  try {
    const me = await assertSuperAdmin();
    const parts = text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length > 50) return { ok: false, error: "That is too many lines. Enter up to 50." };
    const lines: string[] = [];
    for (const part of parts) {
      const n = normalizePhone(part);
      if (!n) return { ok: false, error: `"${part}" is not a usable phone number.` };
      if (!lines.includes(n)) lines.push(n);
    }
    await saveMembershipLines(lines);
    await audit(me.id, "settings.membership_lines", undefined, { count: lines.length });
    revalidatePath("/ivr/admin/integrations");
    return { ok: true, message: lines.length ? `Saved ${lines.length} Membership line${lines.length === 1 ? "" : "s"}.` : "Cleared. Only calls handled by linked agents are kept." };
  } catch (e) {
    return fail(e);
  }
}

const autoSyncSchema = z.object({
  enabled: z.boolean(),
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(1).max(24),
  minGapSec: z.number().int().min(30).max(3600),
});

/** Automatic call sync: on/off, the IST working hours it runs in, and the minimum gap between runs. */
export async function saveAutoSyncAction(input: z.input<typeof autoSyncSchema>): Promise<ActionResult> {
  try {
    const me = await assertSuperAdmin();
    const p = autoSyncSchema.safeParse(input);
    if (!p.success) return { ok: false, error: zodMsg(p.error) };
    if (p.data.endHour <= p.data.startHour) return { ok: false, error: "The end hour must be later than the start hour." };
    await saveAutoSyncConfig(p.data);
    await audit(me.id, "settings.autosync", undefined, p.data);
    revalidatePath("/ivr/admin/integrations");
    return { ok: true, message: p.data.enabled ? "Automatic sync saved." : "Automatic sync is off. Webhooks and the daily sync still run." };
  } catch (e) {
    return fail(e);
  }
}

export async function webhookUrl(): Promise<string> {
  await assertSuperAdmin();
  return `${env.appUrl}/api/ivr/webhooks/smartflo/${env.webhookSecret || "<set SMARTFLO_WEBHOOK_SECRET>"}`;
}
