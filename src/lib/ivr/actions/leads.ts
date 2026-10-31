"use server";

import { and, desc, eq, gte, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/ivr/db";
import { callCategories, calls, dialRequests, integrations, leads, leadStageEvents, notes } from "@/db/ivr-schema";
import { callTargetFor, fallbackTargetsFor, type CallTarget } from "@/lib/ivr/agent-number";
import { audit } from "@/lib/ivr/audit";
import { decryptJson } from "@/lib/ivr/crypto";
import { assertUser, isAdminRole, type SessionUser } from "@/lib/ivr/dal";
import { env } from "@/lib/ivr/env";
import { normalizePhone } from "@/lib/ivr/phone";
import { MOCK_DID } from "@/lib/ivr/smartflo/mock";
import { ingestCalls } from "@/lib/ivr/smartflo/ingest";
import { getSmartflo } from "@/lib/ivr/smartflo";
import { getLiveCalls } from "@/lib/ivr/smartflo/sync";
import type { SfCall } from "@/lib/ivr/smartflo/types";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

async function loadLead(id: string, user: SessionUser) {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) throw new Error("Member not found");
  const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!lead || (!isAdminRole(user.role) && lead.ownerId !== user.id)) throw new Error("Member not found");
  return lead;
}

function refresh() {
  for (const p of ["/ivr", "/ivr/pipeline", "/ivr/admin", "/ivr/admin/members", "/ivr/admin/analytics"]) revalidatePath(p);
}

function fail(e: unknown): ActionResult {
  return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
}

/** Closing and reopening are the only stage changes a person makes. Every other stage comes from calls. */
export async function closeLead(leadId: string): Promise<ActionResult> {
  try {
    const user = await assertUser();
    const lead = await loadLead(leadId, user);
    if (lead.stage === "closed") return { ok: true };
    await db.update(leads).set({ stage: "closed", updatedAt: new Date() }).where(eq(leads.id, lead.id));
    await db.insert(leadStageEvents).values({ leadId: lead.id, fromStage: lead.stage, toStage: "closed", byUserId: user.id });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function reopenLead(leadId: string): Promise<ActionResult> {
  try {
    const user = await assertUser();
    const lead = await loadLead(leadId, user);
    if (lead.stage !== "closed") return { ok: true };
    const stage = lead.lastOutcome === "answered" ? "connected" : lead.attempts > 0 ? "attempted" : "new";
    await db.update(leads).set({ stage, updatedAt: new Date() }).where(eq(leads.id, lead.id));
    await db.insert(leadStageEvents).values({ leadId: lead.id, fromStage: "closed", toStage: stage, byUserId: user.id });
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function saveNote(leadId: string, body: string): Promise<ActionResult> {
  try {
    const user = await assertUser();
    const lead = await loadLead(leadId, user);
    const text = body.trim();
    if (!text) return { ok: false, error: "Write a note first." };
    if (text.length > 4000) return { ok: false, error: "Notes can be up to 4000 characters." };
    await db.insert(notes).values({ leadId: lead.id, userId: user.id, body: text });
    await db.update(leads).set({ updatedAt: new Date() }).where(eq(leads.id, lead.id));
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

const detailsSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email")]),
  company: z.string().trim().max(200),
  memberCode: z.string().trim().max(100),
  categoryId: z.union([z.literal(""), z.string().uuid()]),
});

export async function updateLeadDetails(leadId: string, input: z.input<typeof detailsSchema>): Promise<ActionResult> {
  try {
    const user = await assertUser();
    const lead = await loadLead(leadId, user);
    const p = detailsSchema.safeParse(input);
    if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the details" };
    await db
      .update(leads)
      .set({
        name: p.data.name,
        email: p.data.email || null,
        company: p.data.company || null,
        memberCode: p.data.memberCode || null,
        categoryId: p.data.categoryId || null,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, lead.id));
    await audit(user.id, "lead.update", lead.id);
    refresh();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

async function legacyKeyFor(user: SessionUser): Promise<string> {
  const [conn] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.userId, user.id), eq(integrations.provider, "smartflo_c2c")))
    .limit(1);
  return conn?.encryptedSecret ? decryptJson<{ apiKey: string }>(conn.encryptedSecret).apiKey : "";
}

/** Mock mode only: report a finished call straight away, as the webhook would a few minutes later. */
function mockCall(phone: string, user: SessionUser, agentNumber: string | null, refId: string, dialRequestId: string): SfCall {
  const now = new Date();
  const digit = Number(phone.slice(-1)) || 0;
  const answered = digit % 10 < 6;
  const talk = answered ? 40 + ((digit * 37) % 200) : 0;
  const ring = 12;
  const id = `mock-c2c-${Date.now()}`;
  return {
    callId: id,
    direction: "outbound",
    status: answered ? "answered" : "missed",
    customerNumber: phone,
    didNumber: MOCK_DID,
    // The call is tied to the person through its dial request (see ingest.ts), as a real Call-button call is.
    agentId: null,
    agentName: user.name,
    agentNumber,
    startedAt: now,
    endedAt: new Date(now.getTime() + (ring + talk) * 1000),
    durationSec: ring + talk,
    answeredSec: talk,
    recordingUrl: answered ? `mock://recording/${id}` : null,
    dtmf: null,
    disposition: null,
    hangupCause: answered ? "NORMAL_CLEARING" : digit % 3 === 0 ? "USER_BUSY" : "NO_ANSWER",
    refId,
    dialRequestId,
    callFlow: null,
    raw: { mock: true },
  };
}

/**
 * The Call button. Smartflo rings the agent's phone first, then connects the member.
 * Every press is recorded as a dial request so the call Smartflo reports later is tied to this member and category.
 */
export async function placeCall(leadId: string): Promise<ActionResult> {
  let requestId: string | null = null;
  try {
    const user = await assertUser();
    const lead = await loadLead(leadId, user);
    const phone = normalizePhone(lead.phone);
    if (!phone) return { ok: false, error: "This member has no valid phone number." };
    if (lead.stage === "closed") return { ok: false, error: "This member is closed. Reopen before calling." };

    const live = env.smartfloMode === "live";
    const target = await callTargetFor(user.id);
    const agentNumber = target?.number ?? null;
    const softphone = target?.kind === "softphone";
    const legacyKey = await legacyKeyFor(user);
    if (live && !agentNumber && !legacyKey) {
      return { ok: false, error: "Nothing to ring for you yet. Open Connections and enter your Smartflo softphone extension, or ask an admin to add your phone." };
    }

    // Guard against double clicks and two people dialing the same member.
    const [recent] = await db
      .select({ id: dialRequests.id })
      .from(dialRequests)
      .where(and(eq(dialRequests.leadId, lead.id), gte(dialRequests.requestedAt, new Date(Date.now() - 60_000)), ne(dialRequests.status, "failed")))
      .orderBy(desc(dialRequests.requestedAt))
      .limit(1);
    if (recent) return { ok: false, error: "This member was just dialed. Wait a minute before calling again." };
    if (live && agentNumber && !softphone) {
      const busy = (await getLiveCalls()).some((l) => normalizePhone(l.agentNumber) === agentNumber);
      if (busy) return { ok: false, error: "You are on a call right now. Finish it before dialing the next member." };
    }

    const [req] = await db
      .insert(dialRequests)
      .values({ leadId: lead.id, userId: user.id, categoryId: lead.categoryId })
      .returning({ id: dialRequests.id });
    requestId = req.id;

    const sf = await getSmartflo();
    const identifier = { dr: req.id.replace(/-/g, "") };
    let refId: string;
    let sfMessage: string | undefined;
    let rang: CallTarget | null = target;
    if (agentNumber || !live) {
      const ring = (n: string) =>
        sf.clickToCallAgent({ agentNumber: n, destinationNumber: phone, callerId: env.callerId || undefined, customIdentifier: identifier });
      try {
        ({ refId, message: sfMessage } = await ring(agentNumber ?? "+919000000000"));
      } catch (e) {
        // Smartflo did not recognise the softphone extension, so no call was started: try the agent ID, then the phone.
        if (!(softphone && e instanceof Error && /invalid agent/i.test(e.message))) throw e;
        const others = await fallbackTargetsFor(user.id);
        let done: { refId: string; message?: string } | null = null;
        let lastErr: unknown = e;
        for (const t of others) {
          try {
            done = await ring(t.number);
            rang = t;
            break;
          } catch (e2) {
            lastErr = e2;
          }
        }
        if (!done) throw lastErr;
        ({ refId, message: sfMessage } = done);
      }
    } else {
      // No agent number on file: fall back to the personal Click-to-Call Support key (this variant rings the member first).
      ({ refId } = await sf.clickToCall({ apiKey: legacyKey, customerNumber: phone, customIdentifier: identifier }));
    }
    await db.update(dialRequests).set({ refId: refId || null }).where(eq(dialRequests.id, req.id));

    if (sf.mode === "mock") {
      await ingestCalls([mockCall(phone, user, agentNumber, refId, req.id)], "click_to_call");
    }
    await audit(user.id, "call.place", lead.id, { refId, requestId: req.id });
    refresh();
    const fellBack = softphone && rang && rang.kind !== "softphone";
    const ring = rang ? ` (${rang.number})` : "";
    return {
      ok: true,
      message:
        (fellBack
          ? `Smartflo did not accept the softphone extension ${agentNumber}, so it rang ${rang!.kind === "agent" ? "your Smartflo agent" : "your phone"}${ring} instead. Check the extension under Connections.`
          : softphone
          ? `Smartflo accepted the request and is ringing your browser softphone (ext ${agentNumber}). Answer it in your Smartflo web phone and it connects the member.`
          : agentNumber || !live
          ? `Smartflo accepted the request and is ringing your phone${ring} first. Pick up and it connects the member.`
          : "Smartflo accepted the request and is calling the member first. Stay on the line and it connects you.") +
        (sfMessage ? ` Smartflo says: ${sfMessage}` : ""),
    };
  } catch (e) {
    if (requestId) {
      await db
        .update(dialRequests)
        .set({ status: "failed", error: e instanceof Error ? e.message.slice(0, 300) : "failed" })
        .where(eq(dialRequests.id, requestId))
        .catch(() => undefined);
    }
    if (e instanceof Error && /offline/i.test(e.message)) {
      return {
        ok: false,
        error: "Smartflo says your agent is offline. Log in to the Smartflo web phone or app and set yourself Online, then press Call again.",
      };
    }
    return fail(e);
  }
}

const wrapSchema = z.object({
  callId: z.string().uuid(),
  categoryId: z.union([z.literal(""), z.string().uuid()]),
  remark: z.string().trim().max(1000),
});

/** After a call: set what it was about and an optional remark. An agent's choice is never overwritten by a later sync. */
export async function wrapUpCall(input: z.input<typeof wrapSchema>): Promise<ActionResult> {
  try {
    const user = await assertUser();
    const p = wrapSchema.safeParse(input);
    if (!p.success) return { ok: false, error: "Check the category and remark." };
    const [call] = await db.select().from(calls).where(eq(calls.id, p.data.callId)).limit(1);
    if (!call?.leadId) return { ok: false, error: "Call not found." };
    // An agent wraps up only the calls they handled themselves (and only on their own members).
    if (!isAdminRole(user.role) && call.agentUserId !== user.id) return { ok: false, error: "Call not found." };
    await loadLead(call.leadId, user);
    if (p.data.categoryId) {
      const [c] = await db.select({ id: callCategories.id }).from(callCategories).where(eq(callCategories.id, p.data.categoryId)).limit(1);
      if (!c) return { ok: false, error: "Unknown category." };
    }
    await db
      .update(calls)
      .set({
        categoryId: p.data.categoryId || null,
        categorySource: p.data.categoryId ? "agent" : null,
        remark: p.data.remark || null,
        updatedAt: new Date(),
      })
      .where(eq(calls.id, call.id));
    await audit(user.id, "call.wrapup", call.id);
    refresh();
    return { ok: true, message: "Call updated" };
  } catch (e) {
    return fail(e);
  }
}
