"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { api } from "@/components/approvals/api";
import { formatDateTime } from "@/lib/approvals/format";

type Item = { id: string; title: string; body: string | null; link: string | null; read: boolean; createdAt: string };

/** The bell in the sidebar: a count of unread notifications, and a panel with the latest ones. Refreshes every minute and on open. */
export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const router = useRouter();
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<Item[] | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/approvals/notifications", { cache: "no-store" });
      if (!res.ok || !res.headers.get("content-type")?.includes("json")) return;
      const json = (await res.json()) as { items: Item[]; unread: number };
      setItems(json.items);
      setUnread(json.unread);
    } catch { /* the bell keeps what it had */ }
  }, []);

  useEffect(() => {
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const toggle = () => { setOpen((v) => !v); if (!open) void load(); };
  const openItem = async (n: Item) => {
    setOpen(false);
    if (!n.read) { setUnread((u) => Math.max(0, u - 1)); void api("POST", "/api/approvals/notifications", { id: n.id }); }
    if (n.link) router.push(n.link);
  };
  const markAll = async () => {
    setItems((s) => s?.map((n) => ({ ...n, read: true })) ?? s);
    setUnread(0);
    await api("POST", "/api/approvals/notifications", {});
  };

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={toggle} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open} title="Notifications" className="zs-icon-btn">
        <Bell size={18} />
        {unread > 0 && <span className="zs-dot">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="zn-panel fixed bottom-14 left-3 z-[70] w-[min(21rem,calc(100vw-1.5rem))]" role="dialog" aria-label="Notifications">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="font-bold">Notifications</span>
            {unread > 0 && <button type="button" onClick={markAll} className="text-xs font-bold text-[var(--z-teal-dark)] hover:underline">Mark all read</button>}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items === null && <p className="px-3 py-4 text-sm text-[var(--z-muted)]">Loading…</p>}
            {items?.length === 0 && <p className="border-t border-[var(--z-line)] px-3 py-4 text-sm text-[var(--z-muted)]">Nothing yet. You will see new requests and decisions here.</p>}
            {items?.map((n) => (
              <button key={n.id} type="button" onClick={() => openItem(n)} className={`zn-item ${n.read ? "" : "zn-unread"}`}>
                <span className="block font-bold">{n.title}</span>
                {n.body && <span className="block text-[var(--z-muted)]">{n.body}</span>}
                <span className="mt-0.5 block text-xs text-[var(--z-muted)]">{formatDateTime(n.createdAt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
