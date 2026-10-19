"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { lockAdmin } from "@/actions/auth";
import type { Role } from "@/db/schema";
import { UserMenu } from "@/components/UserMenu";

export type ShellUser = { name: string; role: Role };

/** The sessionStorage key BackLink reads (see there). */
export const PAGES_SEEN = "hub:pagesSeen";

/**
 * The frame of every page: a top bar (the hub's name, which goes home, the bell and the person's menu) and the page under it. There is no
 * sidebar; everything is reached from the cards on the home page and on the pages they open.
 */
export function HubShell({ user, unread, children }: { user: ShellUser | null; /** Unread notifications; the bell is shown when this is given. */ unread?: number; children: React.ReactNode }) {
  const pathname = usePathname();
  const inAdmin = pathname.startsWith("/administrator");
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
          <span className="border-l border-line pl-3 text-[0.68rem] font-bold uppercase tracking-widest text-primary">App Hub</span>
        </Link>
        {user ? (
          <div className="flex items-center gap-3">
            {unread !== undefined && (
              <Link href="/notifications" aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"} className="relative grid h-10 w-10 place-items-center rounded-md text-muted transition-colors hover:bg-alt hover:text-primary">
                <Bell size={20} />
                {unread > 0 && <span className="absolute right-1 top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-brand-red px-1 text-[0.62rem] font-bold leading-none text-white">{unread > 99 ? "99+" : unread}</span>}
              </Link>
            )}
            <UserMenu name={user.name} role={user.role} />
          </div>
        ) : null}
      </header>
      <main className="px-5 py-6 sm:px-8 sm:py-8 lg:px-12">{children}</main>
    </div>
  );
}
