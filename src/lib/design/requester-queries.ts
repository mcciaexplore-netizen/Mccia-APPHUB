import "server-only";
import { requesterProofs } from "./approvals";
import { cdrFor, type CdrDto } from "./cdr";
import type { SessionUser } from "./dal";
import { filesByIds } from "./files";
import { progressOf } from "./public";
import { getTicket, listTickets, ticketForRequester, toCards, type TicketCard } from "./tickets";

/**
 * My Requests and the requester's ticket page: the person's own requests, each with the proof waiting for them, the approved design and
 * any source-file request. Who the request is assigned to is left out: requesters never see the designer or assignment details.
 */

type Proof = { proofId: string; version: number; fileId: string };
type RequesterCard = Omit<TicketCard, "assigneeId" | "assigneeName">;
export type MyRequest = RequesterCard & {
  pending: (Proof & { expiresAt: string }) | null;
  approved: Proof | null;
  cdr: Pick<CdrDto, "id" | "status" | "createdAt" | "file"> | null;
  declineReason: string | null;
};

const withoutAssignee = (c: TicketCard): RequesterCard => {
  const { assigneeId, assigneeName, ...rest } = c;
  void assigneeId;
  void assigneeName;
  return rest;
};

async function decorate(cards: TicketCard[]): Promise<MyRequest[]> {
  const ids = cards.map((c) => c.id);
  const [proofs, cdr, declined] = await Promise.all([
    requesterProofs(ids),
    cdrFor(ids),
    Promise.all(cards.filter((c) => c.status === "declined").map((c) => getTicket(c.id))),
  ]);
  const reasons = new Map(declined.filter((t) => !!t).map((t) => [t!.id, t!.declineReason]));
  return cards.map((c) => {
    const req = cdr.find((r) => r.ticketId === c.id) ?? null;
    return {
      ...withoutAssignee(c),
      pending: proofs.get(c.id)?.pending ?? null,
      approved: proofs.get(c.id)?.approved ?? null,
      cdr: req ? { id: req.id, status: req.status, createdAt: req.createdAt, file: req.file } : null,
      declineReason: reasons.get(c.id) ?? null,
    };
  });
}

export async function myRequests(userId: string): Promise<MyRequest[]> {
  const cards = (await listTickets({ requesterId: userId, limit: 500 })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return decorate(cards);
}

export type RequesterTicket = MyRequest & {
  brief: string;
  eventName: string | null;
  /** The proof to show: the one waiting for review, else the approved one. */
  proof: { fileId: string; version: number; mime: string; fileName: string; approved: boolean } | null;
  steps: { label: string; at: string | null }[];
  history: { at: string; text: string }[];
};

/** One of the person's own requests, for /design/tickets/[id]. Throws (not found) for anyone else's. */
export async function requesterTicket(u: SessionUser, id: string): Promise<RequesterTicket> {
  const t = await ticketForRequester(u, id);
  const [[r], progress] = await Promise.all([toCards([t]).then(decorate), progressOf(t)]);
  const shown = r.pending ?? r.approved;
  const f = shown ? (await filesByIds([shown.fileId])).get(shown.fileId) : undefined;
  return {
    ...r,
    brief: t.brief,
    eventName: t.eventName,
    proof: shown && f ? { fileId: f.id, version: shown.version, mime: f.mime, fileName: f.fileName, approved: !r.pending } : null,
    steps: progress.steps,
    history: progress.history,
  };
}
