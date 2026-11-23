"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, BarChart3, CalendarCheck, CalendarDays, CheckSquare, Clock, Home, LayoutGrid, Settings, Sun, UserRound, Users, Wallet, type LucideIcon } from "lucide-react";
import { ATT_NAV, BOTTOM_NAV, navFor, type AttNavItem, type AttRole, type AttSection } from "@/lib/attendance/att.manifest";

const ICONS: Record<AttNavItem["icon"], LucideIcon> = {
  home: Home,
  leave: CalendarDays,
  time: Clock,
  more: LayoutGrid,
  today: Sun,
  approvals: CheckSquare,
  people: Users,
  attendance: CalendarCheck,
  tracker: Wallet,
  reports: BarChart3,
  settings: Settings,
  back: ArrowLeft,
  profile: UserRound,
};

/** Which menu item a page belongs to: the longest matching address in the section. */
function activeHref(pathname: string, items: AttNavItem[], section: AttSection): string | null {
  const inSection = (href: string) => (section === "staff" ? !href.startsWith("/attendance/admin") : href.startsWith("/attendance/admin"));
  const hits = items.filter((i) => inSection(i.href) && (pathname === i.href || pathname.startsWith(`${i.href}/`)));
  return hits.sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
}

/**
 * The section's sidebar (laptop and up; on a phone the staff app uses the bottom bar, the admin app the menu button): the MCCIA logo (back
 * to the App Hub), "APP HUB", the section's pages as pills (the current one light green), and a soft green blob at the bottom.
 */
export function AttSidebar({ section, roles, badges = {} }: { section: AttSection; roles: AttRole[]; badges?: Record<string, number> }) {
  const pathname = usePathname();
  const items = navFor(section, roles);
  const on = activeHref(pathname, items, section);
  return (
    <nav aria-label={ATT_NAV[section].title} className="att-side">
      <Link href="/" className="mb-6 block px-3" title="Back to the App Hub">
        <Image src="/mccia-logo.png" alt="MCCIA" width={134} height={36} className="h-8 w-auto" />
        <span className="mt-2 block text-[0.68rem] font-bold uppercase tracking-[0.18em] text-gray-400">App Hub</span>
      </Link>
      <p className="px-4 pb-2 text-[0.66rem] font-bold uppercase tracking-widest text-gray-400">{ATT_NAV[section].title}</p>
      <ul className="relative z-10 flex flex-col gap-1">
        {items.map((i) => {
          const I = ICONS[i.icon];
          const n = badges[i.href] ?? 0;
          return (
            <li key={i.href}>
              <Link href={i.href} aria-current={on === i.href ? "page" : undefined} className="att-side-item">
                <I size={18} aria-hidden />
                <span className="flex-1">{i.label}</span>
                {n > 0 && <span className="rounded-full bg-[var(--att-amber)] px-2 py-0.5 text-[0.7rem] font-bold text-white">{n}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The staff app's bottom bar on a phone (below 768 px): Home, Leave, Time, More, Profile. */
export function AttBottomNav({ badges = {} }: { badges?: Record<string, number> }) {
  const pathname = usePathname();
  const items = BOTTOM_NAV;
  const on = activeHref(pathname, items, "staff");
  return (
    <nav className="att-bottom-nav" aria-label="Attendance">
      {items.map((i) => {
        const I = ICONS[i.icon];
        const n = badges[i.href] ?? 0;
        return (
          <Link key={i.href} href={i.href} aria-current={on === i.href ? "page" : undefined} className="relative">
            <I size={20} aria-hidden />
            {i.label}
            {n > 0 && <span className="absolute right-[26%] top-1 h-2 w-2 rounded-full bg-[var(--att-amber)]" aria-label={`${n} waiting`} />}
          </Link>
        );
      })}
    </nav>
  );
}
