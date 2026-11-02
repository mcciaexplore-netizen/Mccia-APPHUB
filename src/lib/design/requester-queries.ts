import "server-only";
import { requesterProofs } from "./approvals";
import { cdrFor, type CdrDto } from "./cdr";
import { getTicket, listTickets, type TicketCard } from "./tickets";

/** My Requests: the person's own requests, each with the proof waiting for them, the approved design and any source-file request. */

export type MyRequest = TicketCard & {
  pending: { proofId: string; version: number; fileId: string; expiresAt: string } | null;
  approved: { proofId: string; version: number; fileId: string } | null;
  cdr: Pick<CdrDto, "id" | "status" | "createdAt" | "file"> | null;
  declineReason: string | null;
};

export async function myRequests(userId: string): Promise<MyRequest[]> {
  const cards = (await listTickets({ requesterId: userId, limit: 500 })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
      ...c,
      pending: proofs.get(c.id)?.pending ?? null,
      approved: proofs.get(c.id)?.approved ?? null,
      cdr: req ? { id: req.id, status: req.status, createdAt: req.createdAt, file: req.file } : null,
      declineReason: reasons.get(c.id) ?? null,
    };
  });
}
