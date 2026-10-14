import "server-only";
import { and, count, desc, eq, isNull, lt } from "drizzle-orm";
import { db } from "@/db";
import { aprNotifications } from "@/db/approvals-schema";
import { getDirectoryUsers } from "./host-adapter";
import { absoluteLink, mailHtml, sendMail } from "./mail";

export type Notice = {
  userId: string;
  requestId?: string | null;
  title: string;
  /** One short line under the title, in the bell and in the email. */
  body?: string;
  /** A path inside the module, for example /approvals/requests/<id>. */
  link?: string;
  /** Also send an email (when SMTP is set up). */
  email?: boolean;
};

/**
 * Tells one person something: a row for the bell, and optionally an email. It never throws: a notification that cannot be saved or
 * sent must not undo the submission or decision that caused it.
 */
export async function notify(n: Notice): Promise<void> {
  try {
    await db.insert(aprNotifications).values({ userId: n.userId, requestId: n.requestId ?? null, title: n.title, body: n.body ?? null, link: n.link ?? null });
  } catch (e) {
    console.error("[approvals] could not save notification", e);
  }
  if (!n.email) return;
  try {
    const [person] = await getDirectoryUsers([n.userId]);
    if (!person?.email) return;
    await sendMail(person.email, n.title, mailHtml(n.title, n.body ? [n.body] : [], n.link ? { label: "Open the request", href: absoluteLink(n.link) } : undefined));
  } catch (e) {
    console.error("[approvals] could not email notification", e);
  }
}

export type BellItem = { id: string; title: string; body: string | null; link: string | null; read: boolean; createdAt: Date };

export async function unreadCount(userId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(aprNotifications).where(and(eq(aprNotifications.userId, userId), isNull(aprNotifications.readAt)));
  return row?.n ?? 0;
}

export async function recentNotifications(userId: string, limit = 20): Promise<BellItem[]> {
  const rows = await db.select().from(aprNotifications).where(eq(aprNotifications.userId, userId)).orderBy(desc(aprNotifications.createdAt)).limit(limit);
  return rows.map((r) => ({ id: r.id, title: r.title, body: r.body, link: r.link, read: !!r.readAt, createdAt: r.createdAt }));
}

/** Marks one notification, or all of the person's unread ones, as read. Only their own rows can be touched. */
export async function markRead(userId: string, id?: string): Promise<void> {
  await db
    .update(aprNotifications)
    .set({ readAt: new Date() })
    .where(and(eq(aprNotifications.userId, userId), isNull(aprNotifications.readAt), id ? eq(aprNotifications.id, id) : undefined));
}

/** Old, already read notifications are dropped now and then so the table stays small. */
export async function pruneNotifications(days = 90): Promise<void> {
  await db.delete(aprNotifications).where(lt(aprNotifications.createdAt, new Date(Date.now() - days * 86400000)));
}
