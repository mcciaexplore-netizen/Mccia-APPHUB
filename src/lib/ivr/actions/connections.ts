"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/ivr/db";
import { integrations, smartfloAgents } from "@/db/ivr-schema";
import { saveProfile } from "@/lib/ivr/host-adapter";
import { audit } from "@/lib/ivr/audit";
import { encryptJson } from "@/lib/ivr/crypto";
import { EXTENSION_RE } from "@/lib/ivr/agent-number";
import { assertUser } from "@/lib/ivr/dal";
import { normalizePhone } from "@/lib/ivr/phone";
import type { ActionResult } from "./leads";

const fail = (e: unknown): ActionResult => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong" });

/**
 * Agents confirm who they are in Smartflo by typing the phone number registered on their Smartflo agent.
 * A match links their calls to this CRM account. Anything else is left to an admin, so nobody can claim another agent's calls.
 */
export async function linkMyAgentByPhone(phone: string): Promise<ActionResult> {
  try {
    const user = await assertUser();
    const n = normalizePhone(phone);
    if (!n) return { ok: false, error: "Enter the phone number registered on your Smartflo agent." };
    const agents = await db.select().from(smartfloAgents);
    const hits = agents.filter((a) => normalizePhone(a.number) === n);
    if (hits.length !== 1) {
      return { ok: false, error: "No single Smartflo agent uses that number. Ask your admin to link you." };
    }
    const agent = hits[0];
    if (agent.mappedUserId && agent.mappedUserId !== user.id) {
      return { ok: false, error: "That Smartflo agent is already linked to another account. Ask your admin." };
    }
    await db.update(smartfloAgents).set({ mappedUserId: user.id }).where(eq(smartfloAgents.id, agent.id));
    await saveProfile(user.id, { smartfloAgentId: agent.id, phone: n });
    await audit(user.id, "ivr.link", agent.id);
    revalidatePath("/ivr/connections");
    return { ok: true, message: `Linked to ${agent.name}. Your calls will appear on your dashboard.` };
  } catch (e) {
    return fail(e);
  }
}

/** Browser calling: the Smartflo softphone extension Smartflo rings first. Empty clears it and goes back to the phone number. */
export async function saveMySoftphone(extension: string): Promise<ActionResult> {
  try {
    const user = await assertUser();
    const ext = extension.replace(/\s/g, "");
    if (ext && !EXTENSION_RE.test(ext)) return { ok: false, error: "An extension is digits only, for example 060123456." };
    await saveProfile(user.id, { softphoneExtension: ext || null });
    await audit(user.id, "softphone.save", undefined, { set: !!ext });
    revalidatePath("/ivr/connections");
    return {
      ok: true,
      message: ext ? `Saved. The Call button now rings your browser softphone (ext ${ext}).` : "Cleared. The Call button rings your phone again.",
    };
  } catch (e) {
    return fail(e);
  }
}

export async function saveClickToCallKey(apiKey: string): Promise<ActionResult> {
  try {
    const user = await assertUser();
    const key = z.string().trim().min(8, "That key looks too short.").max(200).safeParse(apiKey);
    if (!key.success) return { ok: false, error: key.error.issues[0]?.message ?? "Invalid key" };
    const secret = encryptJson({ apiKey: key.data });
    const [existing] = await db
      .select({ id: integrations.id })
      .from(integrations)
      .where(and(eq(integrations.userId, user.id), eq(integrations.provider, "smartflo_c2c")))
      .limit(1);
    if (existing) {
      await db
        .update(integrations)
        .set({ encryptedSecret: secret, status: "connected", updatedAt: new Date(), lastError: null })
        .where(eq(integrations.id, existing.id));
    } else {
      await db.insert(integrations).values({ userId: user.id, provider: "smartflo_c2c", encryptedSecret: secret });
    }
    await audit(user.id, "ivr.c2c_key.save");
    revalidatePath("/ivr/connections");
    return { ok: true, message: "Click-to-Call key saved. The Call button is on." };
  } catch (e) {
    return fail(e);
  }
}

export async function removeClickToCallKey(): Promise<ActionResult> {
  try {
    const user = await assertUser();
    await db.delete(integrations).where(and(eq(integrations.userId, user.id), eq(integrations.provider, "smartflo_c2c")));
    await audit(user.id, "ivr.c2c_key.remove");
    revalidatePath("/ivr/connections");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
