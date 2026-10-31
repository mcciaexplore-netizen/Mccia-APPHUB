import "server-only";
import { and, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/ivr/db";
import { leadAssignments, leads } from "@/db/ivr-schema";
import { listIvrAgents } from "./host-adapter";
import { audit } from "@/lib/ivr/audit";

export type AssignMode = "one" | "split" | "balanced";

const OPEN_STAGES = ["new", "attempted"] as const;
const CHUNK = 500;

const chunk = <T,>(arr: T[], n = CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/** Open members (new or attempted) per agent (everyone given IVR-CRM), for the assign dialog. */
export async function getAgentWorkload(): Promise<{ id: string; name: string; open: number }[]> {
  const agents = (await listIvrAgents()).map((a) => ({ id: a.id, name: a.name }));
  if (!agents.length) return [];
  const counts = await db
    .select({ ownerId: leads.ownerId, n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(inArray(leads.ownerId, agents.map((a) => a.id)), inArray(leads.stage, [...OPEN_STAGES])))
    .groupBy(leads.ownerId);
  const byId = new Map(counts.map((c) => [c.ownerId, Number(c.n)]));
  return agents.map((a) => ({ ...a, open: byId.get(a.id) ?? 0 }));
}

export type AssignResult = {
  count: number;
  skipped: number;
  perAgent: { id: string; name: string; count: number }[];
};

type CurrentLead = { id: string; ownerId: string | null; stage: (typeof leads.$inferSelect)["stage"] };

async function loadLeads(ids: string[]): Promise<CurrentLead[]> {
  const out: CurrentLead[] = [];
  for (const part of chunk(ids)) {
    out.push(...(await db.select({ id: leads.id, ownerId: leads.ownerId, stage: leads.stage }).from(leads).where(inArray(leads.id, part))));
  }
  return out;
}

/** Move ownership and record history. Leads already owned by the target are skipped, so a retry is harmless. */
async function applyOwners(
  targets: Map<string, string | null>,
  current: Map<string, CurrentLead>,
  by: string | null,
  reason: string | null,
): Promise<number> {
  const byOwner = new Map<string | null, string[]>();
  for (const [leadId, owner] of targets) {
    if ((current.get(leadId)?.ownerId ?? null) === owner) continue;
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner)!.push(leadId);
  }
  let moved = 0;
  const now = new Date();
  for (const [owner, ids] of byOwner) {
    for (const part of chunk(ids)) {
      await db.update(leads).set({ ownerId: owner, updatedAt: now }).where(inArray(leads.id, part));
      await db.insert(leadAssignments).values(
        part.map((leadId) => ({
          leadId,
          fromUserId: current.get(leadId)?.ownerId ?? null,
          toUserId: owner,
          byUserId: by,
          reason,
        })),
      );
      moved += part.length;
    }
  }
  return moved;
}

export async function assignLeads(input: {
  leadIds: string[];
  mode: AssignMode;
  agentIds: string[];
  reason?: string | null;
  byUserId: string | null;
}): Promise<AssignResult> {
  const leadIds = [...new Set(input.leadIds)];
  const agentIds = [...new Set(input.agentIds)];
  if (!leadIds.length) throw new Error("Select at least one lead.");
  if (!agentIds.length) throw new Error("Pick at least one agent.");
  if (input.mode === "one" && agentIds.length !== 1) agentIds.length = 1;

  // Only agents can be given members: people who hold the IVR-CRM application now.
  const agents = (await listIvrAgents()).filter((a) => agentIds.includes(a.id));
  const known = new Map(agents.map((a) => [a.id, a.name]));
  const orderedAgents = agentIds.filter((id) => known.has(id));
  if (orderedAgents.length !== agentIds.length) throw new Error("One of the chosen people is not an IVR-CRM agent (they need the IVR-CRM application).");

  const rows = await loadLeads(leadIds);
  const current = new Map(rows.map((r) => [r.id, r]));
  // Keep the caller's order so "split" is predictable.
  const ordered = leadIds.filter((id) => current.has(id));
  const targets = new Map<string, string | null>();

  if (input.mode === "one") {
    for (const id of ordered) targets.set(id, orderedAgents[0]);
  } else if (input.mode === "split") {
    ordered.forEach((id, i) => targets.set(id, orderedAgents[i % orderedAgents.length]));
  } else {
    const workload = await getAgentWorkload();
    const load = new Map(orderedAgents.map((id) => [id, workload.find((w) => w.id === id)?.open ?? 0]));
    for (const id of ordered) {
      const cur = current.get(id)!;
      // A lead that is already open and owned by one of the candidates is already counted in its load.
      const isOpen = (OPEN_STAGES as readonly string[]).includes(cur.stage);
      if (cur.ownerId && load.has(cur.ownerId) && isOpen) load.set(cur.ownerId, load.get(cur.ownerId)! - 1);
      let best = orderedAgents[0];
      for (const a of orderedAgents) if (load.get(a)! < load.get(best)!) best = a;
      targets.set(id, best);
      if (isOpen) load.set(best, load.get(best)! + 1);
    }
  }

  const reason = input.reason?.trim() || null;
  await applyOwners(targets, current, input.byUserId, reason);

  const per = new Map<string, number>();
  for (const owner of targets.values()) if (owner) per.set(owner, (per.get(owner) ?? 0) + 1);
  const result: AssignResult = {
    count: targets.size,
    skipped: leadIds.length - targets.size,
    perAgent: orderedAgents.map((id) => ({ id, name: known.get(id)!, count: per.get(id) ?? 0 })),
  };
  await audit(input.byUserId, "leads.assign", undefined, {
    mode: input.mode,
    count: result.count,
    agentIds: orderedAgents,
    reason,
  });
  return result;
}

/** Return leads to the unassigned pool. */
export async function unassignLeads(input: { leadIds: string[]; reason?: string | null; byUserId: string | null }) {
  const leadIds = [...new Set(input.leadIds)];
  const rows = await loadLeads(leadIds);
  const current = new Map(rows.map((r) => [r.id, r]));
  const targets = new Map<string, string | null>(rows.map((r) => [r.id, null]));
  const reason = input.reason?.trim() || null;
  const moved = await applyOwners(targets, current, input.byUserId, reason);
  await audit(input.byUserId, "leads.unassign", undefined, { count: moved, reason });
  return { count: moved };
}

/** Used by the importer: give a set of (leadId -> owner) assignments in one pass. */
export async function applyAssignments(pairs: { leadId: string; ownerId: string | null }[], by: string | null, reason: string | null) {
  if (!pairs.length) return 0;
  const rows = await loadLeads(pairs.map((p) => p.leadId));
  const current = new Map(rows.map((r) => [r.id, r]));
  const targets = new Map(pairs.map((p) => [p.leadId, p.ownerId] as const));
  return applyOwners(targets, current, by, reason);
}
