"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock, Home, UserRound, type LucideIcon } from "lucide-react";
import { CAB_NAV, navFor, type CabRole } from "@/lib/cabs/cabs.manifest";

const ICON: Record<string, LucideIcon> = { "/cabs": Home, "/cabs/rides": Clock, "/cabs/account": UserRound };

/**
 * The rider app's menu (Book, My rides, Account): a column on the left from a laptop up, a bar along the bottom on a phone. The page open
 * is in teal.
 */
export function CabsSidebar({ roles }: { roles: CabRole[] }) {
  const pathname = usePathname();
  const items = navFor("staff", roles);
  const active = (href: string) => pathname === href || (href !== "/cabs" && pathname.startsWith(`${href}/`));
  return (
    <nav aria-label={CAB_NAV.staff.title}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-black/5 bg-white pb-[env(safe-area-inset-bottom)] lg:static lg:z-auto lg:w-56 lg:shrink-0 lg:self-start lg:rounded-xl lg:border lg:p-2 lg:pb-2">
      <ul className="grid grid-cols-3 lg:grid-cols-1 lg:gap-1">
        {items.map((i) => {
          const Icon = ICON[i.href] ?? Home;
          const on = active(i.href);
          return (
            <li key={i.href}>
              <Link href={i.href} aria-current={on ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-semibold transition-colors lg:min-h-12 lg:flex-row lg:justify-start lg:gap-3 lg:rounded-lg lg:px-3 lg:text-sm ${
                  on ? "text-[#2a6b7c] lg:bg-[#e8f3f5]" : "text-muted hover:text-ink lg:hover:bg-[#f5f5f5]"}`}>
                <Icon size={20} aria-hidden />{i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
