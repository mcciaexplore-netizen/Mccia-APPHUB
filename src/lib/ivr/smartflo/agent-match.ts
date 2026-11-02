import { normalizePhone } from "@/lib/ivr/phone";
import type { SfCall } from "./types";

/** Who took a call, from what Smartflo reports. Pure (no database), so the unit tests run it on real payloads. */
export type AgentCtx = {
  byAgentId: Map<string, { userId: string | null; id: string }>;
  byNumber: Map<string, string>; // e164 -> user id
  byExt: Map<string, string>; // softphone extension digits -> user id
};

export const digitsOf = (n: string | null | undefined): string => (n ?? "").replace(/\D/g, "");

/**
 * The lookup tables from the synced Smartflo agents and the hub's IVR callers. A softphone extension (Smartflo's 13-digit
 * 0607128930025 form, or a short one) is matched on its exact digits, from either the Smartflo agent or the caller's own profile.
 */
export function buildAgentCtx(
  agents: { id: string; extension: string | null; number: string | null; mappedUserId: string | null }[],
  users: { id: string; phone: string | null; smartfloAgentId: string | null; ext: string | null }[],
): AgentCtx {
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
  for (const u of users) {
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

/** The Smartflo agent id first, then the softphone extension (calls taken in the browser report it as the agent number), then the phone. */
export function resolveAgent(ctx: AgentCtx, c: Pick<SfCall, "agentId" | "agentNumber">): { userId: string | null; agentId: string | null } {
  if (c.agentId && ctx.byAgentId.has(c.agentId)) {
    const hit = ctx.byAgentId.get(c.agentId)!;
    return { userId: hit.userId, agentId: hit.id };
  }
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
