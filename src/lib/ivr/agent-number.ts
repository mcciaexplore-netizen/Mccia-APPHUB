import { eq } from "drizzle-orm";
import { db } from "@/lib/ivr/db";
import { smartfloAgents } from "@/db/ivr-schema";
import { personById } from "./host-adapter";
import { normalizePhone } from "@/lib/ivr/phone";

/** Smartflo softphone extensions are plain digits (for example 060123456 or the 13-digit 0607128930003). */
export const EXTENSION_RE = /^\d{3,16}$/;

export type CallTarget = {
  /** What Smartflo rings first: the browser softphone extension, or the agent's phone. */
  number: string;
  kind: "softphone" | "agent" | "phone";
};

/**
 * Where Smartflo rings first for this user. A softphone extension (browser calling) wins; otherwise their mapped Smartflo agent's
 * number, then the phone on their CRM profile.
 */
export async function callTargetFor(userId: string): Promise<CallTarget | null> {
  const p = await personById(userId);
  const u = p && { phone: p.phone, ext: p.softphoneExtension };
  const ext = u?.ext?.trim();
  if (ext && EXTENSION_RE.test(ext)) return { number: ext, kind: "softphone" };
  const [agent] = await db
    .select({ number: smartfloAgents.number })
    .from(smartfloAgents)
    .where(eq(smartfloAgents.mappedUserId, userId))
    .limit(1);
  const phone = normalizePhone(agent?.number) ?? normalizePhone(u?.phone);
  return phone ? { number: phone, kind: "phone" } : null;
}

/** The Smartflo extension recorded on this user's mapped agent, offered as a hint when they set up browser calling. */
export async function detectedExtensionFor(userId: string): Promise<string | null> {
  const [agent] = await db
    .select({ extension: smartfloAgents.extension })
    .from(smartfloAgents)
    .where(eq(smartfloAgents.mappedUserId, userId))
    .limit(1);
  const ext = agent?.extension?.trim();
  return ext && EXTENSION_RE.test(ext) ? ext : null;
}

/**
 * Other ways to reach this user's agent, tried in order when Smartflo rejects the softphone extension: the Smartflo agent ID
 * (Smartflo rings whatever that agent is logged in on), then their phone number.
 */
export async function fallbackTargetsFor(userId: string): Promise<CallTarget[]> {
  const [agent] = await db
    .select({ id: smartfloAgents.id, number: smartfloAgents.number })
    .from(smartfloAgents)
    .where(eq(smartfloAgents.mappedUserId, userId))
    .limit(1);
  const u = await personById(userId);
  const out: CallTarget[] = [];
  if (agent?.id && /^\d{4,}$/.test(agent.id)) out.push({ number: agent.id, kind: "agent" });
  const phone = normalizePhone(agent?.number) ?? normalizePhone(u?.phone);
  if (phone) out.push({ number: phone, kind: "phone" });
  return out;
}
