import "server-only";
import { and, desc, eq, ilike, inArray } from "drizzle-orm";
import { db } from "./db";
import { auditLogs, tickets, type Ticket } from "@/db/design-schema";
import { listTickets, toCards, type TicketCard } from "./tickets";

/** The admin section's own reads, on top of tickets.ts and reports.ts. */

/** Requests waiting in Pending Review, oldest first, each with the start of its brief. */
export async function pendingItems() {
  const cards = (await listTickets({ statuses: ["pending_review"] })).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!cards.length) return [];
  const briefs = await db.select({ id: tickets.id, brief: tickets.brief }).from(tickets).where(inArray(tickets.id, cards.map((c) => c.id)));
  const byId = new Map(briefs.map((b) => [b.id, b.brief]));
  return cards.map((c) => ({ ...c, briefExcerpt: (byId.get(c.id) ?? "").replace(/\s+/g, " ").trim().slice(0, 220) }));
}

export type AcceptedItem = TicketCard & { acceptedAt: string };

/**
 * Every request this lead accepted from Pending Review (the "Accepted" entries they made in the audit log), newest acceptance first. A
 * request that has since had changes asked for is shown as its latest version (DF-0001-V2 ...), since that is where its progress is now.
 */
export async function acceptedBy(leadId: string): Promise<AcceptedItem[]> {
  const rows = await db
    .select({ t: tickets, at: auditLogs.createdAt })
    .from(auditLogs)
    .innerJoin(tickets, eq(tickets.id, auditLogs.ticketId))
    .where(and(eq(auditLogs.action, "Accepted"), eq(auditLogs.userId, leadId)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(200);
  const latest = await Promise.all(
    rows.map(async ({ t }): Promise<Ticket> => {
      if (t.status !== "superseded") return t;
      const [v] = await db.select().from(tickets).where(ilike(tickets.number, `${t.number.split("-V")[0]}-V%`)).orderBy(desc(tickets.versionNumber)).limit(1);
      return v ?? t;
    }),
  );
  const cards = await toCards(latest);
  return cards.map((c, i) => ({ ...c, acceptedAt: rows[i].at.toISOString() }));
}
