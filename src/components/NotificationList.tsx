"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { markAllNotificationsRead, markNotificationRead } from "@/actions/notifications";
import { useToast } from "@/components/Toast";
import { formatIST } from "@/lib/format";

export type NoticeItem = { key: string; source: "hub" | "approvals"; id: string; title: string; body: string | null; link: string | null; read: boolean; at: string };

/** The person's own notifications, newest first: from the hub (access and role changes) and from the Approval System. */
export function NotificationList({ items }: { items: NoticeItem[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [read, setRead] = useState<Set<string>>(new Set(items.filter((i) => i.read).map((i) => i.key)));
  const unread = items.filter((i) => !read.has(i.key)).length;

  const markOne = (i: NoticeItem) => {
    setRead((s) => new Set(s).add(i.key));
    start(async () => {
      if (i.source === "hub") await markNotificationRead(i.id);
      else await fetch("/api/approvals/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: i.id }) }).catch(() => {});
      router.refresh();
    });
  };
  const markAll = () => start(async () => {
    const r = await markAllNotificationsRead();
    await fetch("/api/approvals/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
    if (r.ok) { setRead(new Set(items.map((i) => i.key))); toast.success("All marked as read"); router.refresh(); } else toast.error(r.error);
  });

  if (items.length === 0) {
    return <div className="glass mx-auto max-w-xl p-8 text-center"><div className="icon-tile mx-auto mb-4"><Bell size={18} /></div><h2 className="text-2xl">No notifications yet</h2><p className="mt-2 text-sm text-muted">When your access changes or a request needs you, it appears here.</p></div>;
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{unread === 0 ? "You are all caught up." : `${unread} unread`}</p>
        <button className="btn btn-ghost btn-sm" disabled={pending || unread === 0} onClick={markAll}><CheckCheck size={14} /> Mark all as read</button>
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-md border border-line bg-white">
        {items.map((i) => {
          const isRead = read.has(i.key);
          const text = (
            <>
              <span className={`block text-sm ${isRead ? "text-ink" : "font-bold text-ink"}`}>{i.title}</span>
              {i.body && <span className="block text-sm text-muted">{i.body}</span>}
              <span className="block text-xs text-subtle">{formatIST(new Date(i.at))} · {i.source === "approvals" ? "Approval System" : "App Hub"}</span>
            </>
          );
          return (
            <li key={i.key} className={`flex items-start gap-3 px-4 py-3 ${isRead ? "" : "bg-blue-tint"}`}>
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${isRead ? "bg-transparent" : "bg-primary"}`} aria-hidden />
              <div className="min-w-0 flex-1">{i.link ? <Link href={i.link} onClick={() => !isRead && markOne(i)} className="block hover:underline">{text}</Link> : <div>{text}</div>}</div>
              {!isRead && <button className="btn btn-ghost btn-sm shrink-0" disabled={pending} onClick={() => markOne(i)}>Mark read</button>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
