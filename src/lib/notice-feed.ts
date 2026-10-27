import "server-only";
import { approvalsEnabled } from "@/lib/approvals/flags";
import { recentNotifications, unreadCount as approvalsUnread } from "@/lib/approvals/notify";
import type { NoticeItem } from "@/components/NotificationList";
import { hubUnreadCount, listHubNotifications } from "@/lib/notifications";
import { logError } from "@/lib/log-error";

/** Everything addressed to one person, from the hub and from the Approval System, newest first. Only ever one person's own rows. */
export async function noticeFeed(userId: string): Promise<NoticeItem[]> {
  const [hub, apr] = await Promise.all([listHubNotifications(userId, 50), approvalsEnabled() ? recentNotifications(userId, 50) : Promise.resolve([])]);
  return [
    ...hub.map((n): NoticeItem => ({ key: `h:${n.id}`, source: "hub", id: n.id, title: n.title, body: n.body, link: n.link, read: n.read, at: n.createdAt.toISOString() })),
    ...apr.map((n): NoticeItem => ({ key: `a:${n.id}`, source: "approvals", id: n.id, title: n.title, body: n.body, link: n.link, read: n.read, at: n.createdAt.toISOString() })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 80);
}

/** How many are unread across both, for the bell. */
export async function noticeUnread(userId: string): Promise<number> {
  try {
    const [hub, apr] = await Promise.all([hubUnreadCount(userId), approvalsEnabled() ? approvalsUnread(userId) : Promise.resolve(0)]);
    return hub + apr;
  } catch (e) {
    // The bell is a convenience: it must never take a page down with it.
    logError("[hub] could not count notifications", e);
    return 0;
  }
}
