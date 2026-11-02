import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "./db";
import { tickets } from "@/db/design-schema";
import { listTickets } from "./tickets";

/** The admin section's own reads, on top of tickets.ts and reports.ts. */

/** Requests waiting in Pending Review, oldest first, each with the start of its brief. */
export async function pendingItems() {
  const cards = (await listTickets({ statuses: ["pending_review"] })).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!cards.length) return [];
  const briefs = await db.select({ id: tickets.id, brief: tickets.brief }).from(tickets).where(inArray(tickets.id, cards.map((c) => c.id)));
  const byId = new Map(briefs.map((b) => [b.id, b.brief]));
  return cards.map((c) => ({ ...c, briefExcerpt: (byId.get(c.id) ?? "").replace(/\s+/g, " ").trim().slice(0, 220) }));
}
