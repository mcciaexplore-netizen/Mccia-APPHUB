"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { lockAdmin } from "@/actions/auth";
import { isAdminPath } from "@/lib/admin-paths";
import type { Role } from "@/db/schema";
import { HubBell } from "@/components/HubBell";
import { PAGES_SEEN } from "@/components/pages-seen";

export type ShellUser = { name: string; role: Role };

/**
 * The frame of every page, the part that runs in the browser (HubShell, which pages use, is the part that runs on the server and hands this
 * the person's menu): a top bar (the hub's name, which goes home, the bell and the person's menu) and the page under it. There is no
 * sidebar; everything is reached from the cards on the home page and on the pages they open.
 */
export function HubFrame({ user, menu, unread, bleed = false, children }: {
  user: ShellUser | null; /** The person's menu (their photo, name and the options under them), drawn at the right of the top bar. */ menu?: React.ReactNode;
  /** Unread notifications; the bell is shown when this is given. */ unread?: number;
  /** The page fills the space under the top bar edge to edge, without the usual margins (Payment Desk's frame). */ bleed?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const inAdmin = isAdminPath(pathname);
  // Administrator locks itself the moment you leave it (the proxy only re-checks on the way in).
  const wasInAdmin = useRef(inAdmin);
  useEffect(() => {
    if (wasInAdmin.current && !inAdmin) void lockAdmin();
    wasInAdmin.current = inAdmin;
  }, [inAdmin]);
  // Counts the pages opened in this tab, so a "← Back" that returns to the previous page knows there is a hub page to return to.
  useEffect(() => {
    try { sessionStorage.setItem(PAGES_SEEN, String(Number(sessionStorage.getItem(PAGES_SEEN) ?? "0") + 1)); } catch {}
  }, [pathname]);

  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-line bg-white px-5 sm:px-8 lg:px-12">
        <Link href="/" className="flex items-center gap-3" aria-label="MCCIA App Hub, home">
          <Image src="/mccia-logo.png" alt="MCCIA" width={134} height={36} priority className="h-8 w-auto" />
          <span className="hidden whitespace-nowrap border-l border-line pl-3 text-[0.68rem] font-bold uppercase tracking-widest text-primary sm:inline">App Hub</span>
        </Link>
        {user ? (
          <div className="flex items-center gap-3">
            {unread !== undefined && <HubBell unread={unread} />}
            {menu}
          </div>
        ) : null}
      </header>
      <main className={bleed ? "page-slot" : "page-slot px-5 py-6 sm:px-8 sm:py-8 lg:px-12"}>{children}</main>
    </div>
  );
}
