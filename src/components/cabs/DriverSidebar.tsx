"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock, Inbox, Navigation, UserRound, type LucideIcon } from "lucide-react";
import { CAB_NAV, navFor, type CabRole } from "@/lib/cabs/cabs.manifest";

const ICON: Record<string, LucideIcon> = { "/cabs/driver": Inbox, "/cabs/driver/trip": Navigation, "/cabs/driver/rides": Clock, "/cabs/driver/profile": UserRound };

/** The driver app's four tabs (Assigned, Trip, History, Profile), along the bottom on every screen, as wide as the app. The tab open is in teal. */
export function CabsDriverSidebar({ roles }: { roles: CabRole[] }) {
  const pathname = usePathname();
  const items = navFor("driver", roles);
  const active = (href: string) => pathname === href || (href !== "/cabs/driver" && pathname.startsWith(`${href}/`));
  return (
    <nav aria-label={CAB_NAV.driver.title} className="fixed bottom-0 left-1/2 z-30 w-full max-w-[480px] -translate-x-1/2 border-t border-black/5 bg-white pb-[env(safe-area-inset-bottom)]">
      <ul className="grid grid-cols-4">
        {items.map((i) => {
          const Icon = ICON[i.href] ?? Inbox;
          const on = active(i.href);
          return (
            <li key={i.href}>
              <Link href={i.href} aria-current={on ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold transition-colors ${on ? "text-[#2a6b7c]" : "text-muted hover:text-ink"}`}>
                <Icon size={21} aria-hidden />{i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
