import "server-only";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { hubNotifications } from "@/db/schema";

/**
 * What the hub tells people: a change to their access, their role, what they may open. One row per person per event, kept in the
 * database. The dedupe key makes the same event written twice a single row. Nothing here can be read by anyone but its owner: every
 * query is scoped to one user id. (The Approval System keeps its own notifications; the notifications page shows both.)
 */

type NewNotice = { userId: string; kind: string; title: string; body?: string | null; link?: string | null; dedupeKey: string };

/** Never throws: a notification that cannot be saved must not undo the change that caused it. */
export async function notifyUsers(notices: NewNotice[]): Promise<void> {
  if (notices.length === 0) return;
  try {
    await db
      .insert(hubNotifications)
      .values(notices.map((n) => ({ userId: n.userId, kind: n.kind, title: n.title, body: n.body ?? null, link: n.link ?? null, dedupeKey: n.dedupeKey })))
      .onConflictDoNothing();
  } catch (e) {
    console.error("[hub] could not save notifications", e);
  }
}

type HubNotice = { id: string; kind: string; title: string; body: string | null; link: string | null; read: boolean; createdAt: Date };

export async function listHubNotifications(userId: string, limit = 50): Promise<HubNotice[]> {
  const rows = await db.select().from(hubNotifications).where(eq(hubNotifications.userId, userId)).orderBy(desc(hubNotifications.createdAt)).limit(limit);
  return rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, read: !!r.readAt, createdAt: r.createdAt }));
}

export async function hubUnreadCount(userId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(hubNotifications).where(and(eq(hubNotifications.userId, userId), isNull(hubNotifications.readAt)));
  return row?.n ?? 0;
}

/** Marks one notification, or all of the person's unread ones, as read. Only their own rows can be touched. */
export async function markHubRead(userId: string, id?: string): Promise<void> {
  await db
    .update(hubNotifications)
    .set({ readAt: new Date() })
    .where(and(eq(hubNotifications.userId, userId), isNull(hubNotifications.readAt), id ? eq(hubNotifications.id, id) : undefined));
}
