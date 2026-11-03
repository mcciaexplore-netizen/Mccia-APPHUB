import "server-only";
import { and, desc, eq, ilike, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { auditLogs, tickets, type Ticket } from "@/db/design-schema";
import type { SessionUser } from "./dal";
import { peopleNamedLike } from "./host-adapter";
import { istMoment, addDays } from "./rules";
import { LIST_TABS, PAGE_SIZE, type ListQuery, type ListTab } from "./ticket-list";
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

/**
 * One page of the All Tickets list, with the total and how many tickets each status tab holds (under the same search and filters). A lead
 * sees every ticket; a designer only the ones assigned to them (see canWork in tickets.ts). Old versions replaced by a newer one are left out.
 */
export async function ticketListPage(u: SessionUser, q: ListQuery): Promise<{ rows: TicketCard[]; total: number; counts: Record<ListTab, number> }> {
  const where: SQL[] = [ne(tickets.status, "superseded")];
  if (!u.lead) where.push(eq(tickets.assigneeId, u.id));
  if (q.designer === "unassigned") where.push(isNull(tickets.assigneeId));
  else if (q.designer) where.push(eq(tickets.assigneeId, q.designer));
  if (q.type) where.push(sql`${tickets.requirements} ? ${q.type}`);
  if (q.priority) where.push(eq(tickets.priority, q.priority));
  if (q.from) where.push(sql`${tickets.createdAt} >= ${istMoment(q.from)}`);
  if (q.to) where.push(sql`${tickets.createdAt} < ${istMoment(addDays(q.to, 1))}`);
  if (q.q.trim()) {
    const like = `%${q.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(sql`(${tickets.number} ilike ${like} or ${tickets.title} ilike ${like} or ${tickets.requesterId} in (${peopleNamedLike(like)}))`);
  }
  const overdue = sql`${tickets.dueAt} < now()`;
  const tabWhere = (t: ListTab): SQL | undefined => {
    const st = LIST_TABS[t].statuses;
    if (!st) return undefined;
    return t === "overdue" ? and(inArray(tickets.status, st), overdue) : inArray(tickets.status, st);
  };
  const tabs = Object.keys(LIST_TABS) as ListTab[];
  const [countRow] = await db
    .select(Object.fromEntries(tabs.map((t) => [t, sql<number>`count(*) filter (where ${tabWhere(t) ?? sql`true`})::int`])) as Record<ListTab, SQL<number>>)
    .from(tickets)
    .where(and(...where));
  const order = {
    created: tickets.createdAt,
    number: tickets.number,
    title: tickets.title,
    priority: sql`array_position(array['urgent','high','normal','low']::text[], ${tickets.priority}::text)`,
    status: tickets.status,
    due: tickets.dueAt,
  }[q.sort];
  const own = tabWhere(q.tab);
  const rows = await db
    .select()
    .from(tickets)
    .where(and(...where, ...(own ? [own] : [])))
    .orderBy(q.dir === "asc" ? sql`${order} asc nulls last` : sql`${order} desc nulls last`, desc(tickets.createdAt))
    .limit(PAGE_SIZE)
    .offset((q.page - 1) * PAGE_SIZE);
  return { rows: await toCards(rows), total: countRow[q.tab], counts: countRow };
}
