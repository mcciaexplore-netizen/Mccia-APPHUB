import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "./db";
import { approvalRequests, proofVersions, type Ticket } from "@/db/design-schema";
import { typeNames } from "./config";
import { effectiveStatus, itemState, progressOf, type ItemState, type Progress } from "./deliverables";

/**
 * Each per-item ticket's deliverables, read from its proofs and review links (see deliverables.ts). Kept apart from approvals.ts and
 * tickets.ts so both can use it without importing each other.
 */

type ProofRef = { proofId: string; version: number; fileId: string };
export type DeliverableDto = {
  key: string;
  name: string;
  state: ItemState;
  /** The proof waiting for the requester, with its open review link. */
  pending: (ProofRef & { requestId: string; expiresAt: string }) | null;
  approved: ProofRef | null;
  /** The newest proof uploaded for it, whatever its state. */
  latest: ProofRef | null;
};

export async function deliverablesFor(rows: Pick<Ticket, "id" | "requirements" | "perItem">[]): Promise<Map<string, { items: DeliverableDto[]; progress: Progress }>> {
  const out = new Map<string, { items: DeliverableDto[]; progress: Progress }>();
  const mine = rows.filter((r) => r.perItem);
  if (!mine.length) return out;
  const ids = mine.map((r) => r.id);
  const [proofs, reqs, names] = await Promise.all([
    db.select().from(proofVersions).where(inArray(proofVersions.ticketId, ids)),
    db.select().from(approvalRequests).where(inArray(approvalRequests.ticketId, ids)),
    typeNames(),
  ]);
  for (const t of mine) {
    const tp = proofs.filter((p) => p.ticketId === t.id);
    const tr = reqs.filter((r) => r.ticketId === t.id);
    const byProof = new Map(tp.map((p) => [p.id, p]));
    const ref = (p: (typeof tp)[number]): ProofRef => ({ proofId: p.id, version: p.version, fileId: p.fileId });
    const items = t.requirements.map((key): DeliverableDto => {
      const kp = tp.filter((p) => p.itemKey === key).sort((a, b) => b.version - a.version);
      const kr = tr.filter((r) => byProof.get(r.proofVersionId)?.itemKey === key).sort((a, b) => +b.createdAt - +a.createdAt);
      const open = kr.find((r) => effectiveStatus(r) === "pending");
      const ok = kr.find((r) => r.status === "approved");
      return {
        key,
        name: names.get(key) ?? key,
        state: itemState(key, tp, tr),
        pending: open ? { ...ref(byProof.get(open.proofVersionId)!), requestId: open.id, expiresAt: open.expiresAt.toISOString() } : null,
        approved: ok ? ref(byProof.get(ok.proofVersionId)!) : null,
        latest: kp[0] ? ref(kp[0]) : null,
      };
    });
    out.set(t.id, { items, progress: progressOf(items.map((i) => i.state)) });
  }
  return out;
}

/** The states of one ticket's items, for deciding where the ticket goes next. */
export async function itemStatesOf(t: Pick<Ticket, "id" | "requirements" | "perItem">): Promise<Map<string, ItemState>> {
  const d = (await deliverablesFor([t])).get(t.id);
  return new Map((d?.items ?? []).map((i) => [i.key, i.state]));
}
