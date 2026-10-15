"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { api } from "@/components/approvals/api";
import { formatDateTime } from "@/lib/approvals/format";

type Item = { id: string; title: string; body: string | null; link: string | null; read: boolean; createdAt: string };

/** The bell: a count of unread notifications, and a panel with the latest ones. Refreshes every minute and when opened. */
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
      <button
        type="button" onClick={toggle} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open} title="Notifications"
        className="relative rounded-md border border-line bg-white p-2.5 text-muted transition-colors hover:border-primary hover:text-primary"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 min-w-[1.1rem] rounded-pill bg-brand-red px-1 text-center text-[0.65rem] font-bold leading-[1.1rem] text-white">{unread > 9 ? "9+" : unread}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[min(21rem,calc(100vw-2rem))] rounded-md border border-line bg-white shadow-card-hover" role="dialog" aria-label="Notifications">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="font-semibold text-ink">Notifications</span>
            {unread > 0 && <button type="button" onClick={markAll} className="text-xs font-semibold text-primary hover:underline">Mark all read</button>}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items === null && <p className="px-3 py-4 text-sm text-subtle">Loading…</p>}
            {items?.length === 0 && <p className="border-t border-line px-3 py-4 text-sm text-subtle">Nothing yet. You will see new requests and decisions here.</p>}
            {items?.map((n) => (
              <button
                key={n.id} type="button" onClick={() => openItem(n)}
                className={`block w-full border-t border-line px-3 py-2.5 text-left text-sm hover:bg-blue-tint ${n.read ? "" : "bg-green-tint"}`}
              >
                <span className="block font-semibold text-ink">{n.title}</span>
                {n.body && <span className="block text-muted">{n.body}</span>}
                <span className="mt-0.5 block text-xs text-subtle">{formatDateTime(n.createdAt)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
