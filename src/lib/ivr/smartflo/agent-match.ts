import type { SfCall } from "./types";

/** Who took a call, from what Smartflo reports. Pure (no database), so the unit tests run it on real payloads. */
export type AgentCtx = {
  /** The synced Smartflo agents, each with the hub user it belongs to (if any). */
  agents: { id: string; ext: string; number: string | null; userId: string | null }[];
  /** IVR-CRM callers: their own phone and softphone extension (as digits). */
  users: { id: string; phone: string | null; ext: string }[];
};

export const digitsOf = (n: string | null | undefined): string => (n ?? "").replace(/\D/g, "");

/**
 * The last 10 digits of a number, Smartflo agent id or extension, or null when it has fewer. A phone's last 10 are the number without
 * +91; Smartflo numbers one seat with ids that differ only in the prefix (agent id 0507128930020, extension 0607128930020).
 */
export const tailOf = (n: string | null | undefined): string | null => {
  const d = digitsOf(n);
  return d.length >= 10 ? d.slice(-10) : null;
};

/** Too short to say anything: the "0" some profiles hold is Smartflo's extension prefix, not an extension. */
const usableExt = (d: string) => (d.length >= 3 ? d : "");

/**
 * The lookup data from the synced Smartflo agents and the hub's IVR callers. An agent belongs to its mapped_user_id, or failing that to
 * the one caller whose profile names it (smartflo_agent_id), so a half-made link still counts.
 */
export function buildAgentCtx(
  agents: { id: string; extension: string | null; number: string | null; mappedUserId: string | null }[],
  users: { id: string; phone: string | null; smartfloAgentId: string | null; ext: string | null }[],
): AgentCtx {
  const owner = (agentId: string) => {
    const named = users.filter((u) => u.smartfloAgentId === agentId);
    return named.length === 1 ? named[0].id : null;
  };
  const known = new Set(agents.map((a) => a.id));
  return {
    agents: [
      ...agents.map((a) => ({ id: a.id, ext: usableExt(digitsOf(a.extension)), number: a.number, userId: a.mappedUserId ?? owner(a.id) })),
      // A profile may name a Smartflo agent the last refresh did not bring in: the id alone still identifies its calls.
      ...users.filter((u) => u.smartfloAgentId && !known.has(u.smartfloAgentId)).map((u) => ({ id: u.smartfloAgentId!, ext: "", number: null, userId: u.id })),
    ],
    users: users.map((u) => ({ id: u.id, phone: u.phone, ext: usableExt(digitsOf(u.ext)) })),
  };
}

/**
 * Who took the call. The first rule that names exactly one hub user wins (a rule that matches two people matches nobody):
 *   1. the Smartflo agent id, exactly (the payload's agent id, or an answering number written the same way)
 *   2. a softphone extension, exactly (Smartflo agent's or the caller's own, 3 digits or more)
 *   3. last 10 digits against the Smartflo agent ids
 *   4. last 10 digits against the Smartflo agents' extensions
 *   5. last 10 digits against the Smartflo agents' numbers
 *   6. last 10 digits against the callers' own phones (ivr_agent_profiles.phone)
 */
export function resolveAgent(ctx: AgentCtx, c: Pick<SfCall, "agentId" | "agentNumber">): { userId: string | null; agentId: string | null } {
  const num = digitsOf(c.agentNumber);
  const tail = tailOf(c.agentNumber) ?? tailOf(c.agentId);
  const agentOf = (userId: string) => ctx.agents.find((a) => a.userId === userId)?.id ?? c.agentId;
  const one = <T extends { userId: string | null }>(hits: T[]): T | null => {
    const people = new Set(hits.map((h) => h.userId).filter(Boolean));
    return people.size === 1 ? hits.find((h) => h.userId)! : null;
  };

  const byId = one(ctx.agents.filter((a) => a.id === c.agentId || (num && digitsOf(a.id) === num)));
  if (byId) return { userId: byId.userId, agentId: byId.id };

  if (num) {
    const ext = one([...ctx.agents.filter((a) => a.ext === num), ...ctx.users.filter((u) => u.ext === num).map((u) => ({ userId: u.id, id: agentOf(u.id) }))]);
    if (ext) return { userId: ext.userId, agentId: ext.id };
  }

  if (tail) {
    for (const field of ["id", "ext", "number"] as const) {
      const hit = one(ctx.agents.filter((a) => tailOf(a[field]) === tail));
      if (hit) return { userId: hit.userId, agentId: hit.id };
    }
    const phone = one(ctx.users.filter((u) => tailOf(u.phone) === tail).map((u) => ({ userId: u.id })));
    if (phone) return { userId: phone.userId, agentId: agentOf(phone.userId!) };
  }

  return { userId: null, agentId: c.agentId };
}
