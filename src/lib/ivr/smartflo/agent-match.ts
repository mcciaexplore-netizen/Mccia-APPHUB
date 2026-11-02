import { normalizePhone } from "@/lib/ivr/phone";
import type { SfCall } from "./types";

/** Who took a call, from what Smartflo reports. Pure (no database), so the unit tests run it on real payloads. */
export type AgentCtx = {
  byAgentId: Map<string, { userId: string | null; id: string }>;
  byNumber: Map<string, string>; // e164 -> user id
  byExt: Map<string, string>; // softphone extension digits -> user id
  byTail: Map<string, string | null>; // last 10 digits of an extension or Smartflo agent id -> user id (null: more than one person)
};

export const digitsOf = (n: string | null | undefined): string => (n ?? "").replace(/\D/g, "");

/**
 * The last 10 digits of a Smartflo extension or agent id. Smartflo numbers one seat in several forms that differ only in the prefix
 * (agent id 0507128930020, softphone extension 0607128930020), so the tail is what they share. Shorter values have no tail.
 */
export const tailOf = (n: string | null | undefined): string | null => {
  const d = digitsOf(n);
  return d.length >= 10 ? d.slice(-10) : null;
};

/**
 * The lookup tables from the synced Smartflo agents and the hub's IVR callers. A softphone extension (Smartflo's 13-digit
 * 0607128930025 form, or a short one) is matched on its exact digits, from either the Smartflo agent or the caller's own profile; failing
 * that, on its last 10 digits against every extension and Smartflo agent id we hold (see tailOf). A tail two people share matches nobody.
 */
export function buildAgentCtx(
  agents: { id: string; extension: string | null; number: string | null; mappedUserId: string | null }[],
  users: { id: string; phone: string | null; smartfloAgentId: string | null; ext: string | null }[],
): AgentCtx {
  const byAgentId = new Map<string, { userId: string | null; id: string }>();
  const byNumber = new Map<string, string>();
  const byExt = new Map<string, string>();
  const byTail = new Map<string, string | null>();
  const addTail = (v: string | null | undefined, userId: string | null) => {
    const t = tailOf(v);
    if (!t || !userId) return;
    byTail.set(t, byTail.has(t) && byTail.get(t) !== userId ? null : userId);
  };
  for (const a of agents) {
    addTail(a.extension, a.mappedUserId);
    addTail(a.id, a.mappedUserId);
    const ext = digitsOf(a.extension);
    if (ext.length >= 3 && a.mappedUserId) byExt.set(ext, a.mappedUserId);
    byAgentId.set(a.id, { userId: a.mappedUserId, id: a.id });
    const n = normalizePhone(a.number);
    if (n && a.mappedUserId) byNumber.set(n, a.mappedUserId);
  }
  for (const u of users) {
    addTail(u.ext, u.id);
    addTail(u.smartfloAgentId, u.id);
    const ext = digitsOf(u.ext);
    if (ext.length >= 3) byExt.set(ext, u.id);
    if (u.smartfloAgentId && !byAgentId.get(u.smartfloAgentId)?.userId) {
      byAgentId.set(u.smartfloAgentId, { userId: u.id, id: u.smartfloAgentId });
    }
    const n = normalizePhone(u.phone);
    if (n && !byNumber.has(n)) byNumber.set(n, u.id);
  }
  return { byAgentId, byNumber, byExt, byTail };
}

/**
 * The Smartflo agent id first, then the softphone extension (calls taken in the browser report it as the agent number): exactly, then by
 * its last 10 digits; then the phone.
 */
export function resolveAgent(ctx: AgentCtx, c: Pick<SfCall, "agentId" | "agentNumber">): { userId: string | null; agentId: string | null } {
  if (c.agentId && ctx.byAgentId.has(c.agentId)) {
    const hit = ctx.byAgentId.get(c.agentId)!;
    return { userId: hit.userId, agentId: hit.id };
  }
  const tail = tailOf(c.agentNumber) ?? tailOf(c.agentId);
  const extUid = ctx.byExt.get(digitsOf(c.agentNumber)) ?? (tail ? ctx.byTail.get(tail) : undefined) ?? undefined;
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
