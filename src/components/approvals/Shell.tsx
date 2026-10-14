"use client";

import { Suspense, useState, useSyncExternalStore } from "react";
import { Menu } from "lucide-react";
import { Sidebar } from "@/components/approvals/Sidebar";
import { approvalsManifest, type ApprovalsRole } from "@/lib/approvals/approvals.manifest";

const LARGE_KEY = "apr-large-text";
const LARGE_EVENT = "apr-large-text-change";

/** "Larger text" is a per-person convenience, so it lives in the browser. Reading it can fail (private windows): then it stays off. */
const readLarge = () => { try { return localStorage.getItem(LARGE_KEY) === "1"; } catch { return false; } };
const watchLarge = (onChange: () => void) => {
  window.addEventListener(LARGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => { window.removeEventListener(LARGE_EVENT, onChange); window.removeEventListener("storage", onChange); };
};
const setLarge = (on: boolean) => {
  try { localStorage.setItem(LARGE_KEY, on ? "1" : "0"); } catch { /* the page works without it */ }
  window.dispatchEvent(new Event(LARGE_EVENT));
};

/** The module's own full-screen layout: a dark sidebar like the Zoho apps, and a white page beside it. */
export function Shell({
  user, unread, waiting, signOut, children,
}: {
  user: { name: string; roles: ApprovalsRole[] };
  unread: number;
  waiting: number;
  signOut: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const large = useSyncExternalStore(watchLarge, readLarge, () => false);
  const close = () => setOpen(false);
  const toggleLarge = () => setLarge(!large);

  const sidebar = (
    <Suspense fallback={<div className="zs h-full" />}>
      <Sidebar user={user} unread={unread} waiting={waiting} large={large} onToggleLarge={toggleLarge} signOut={signOut} onNavigate={close} onClose={close} />
    </Suspense>
  );

  return (
    <div className={`apr-root flex min-h-screen bg-white ${large ? "apr-large" : ""}`}>
      <div className="sticky top-0 hidden h-screen lg:block">{sidebar}</div>

      {open && <div className="fixed inset-0 z-40 bg-black/45 lg:hidden" onClick={close} aria-hidden />}
      <div className={`fixed inset-y-0 left-0 z-50 transition-transform duration-300 lg:hidden ${open ? "translate-x-0" : "-translate-x-full"}`}>{sidebar}</div>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-[var(--z-line)] bg-white px-4 lg:hidden">
          <button aria-label="Open menu" onClick={() => setOpen(true)} className="text-[#444]"><Menu size={22} /></button>
          <span className="font-bold">{approvalsManifest.name}</span>
        </header>
        <main className="px-4 py-5 sm:px-8 sm:py-6">
          <div className="min-h-[calc(100vh-3rem)]">{children}</div>
        </main>
      </div>
    </div>
  );
}
