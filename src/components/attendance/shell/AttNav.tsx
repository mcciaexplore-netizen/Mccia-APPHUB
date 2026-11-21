"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, BarChart3, CalendarCheck, CalendarDays, CheckSquare, Clock, Home, LayoutGrid, Settings, Sun, Users, Wallet, type LucideIcon } from "lucide-react";
import { HubBackLink } from "@/components/BackLink";
import { useSlidingIndicator } from "@/components/SlidingIndicator";
import { ATT_NAV, navFor, type AttNavItem, type AttRole, type AttSection } from "@/lib/attendance/att.manifest";

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
};

/** Which menu item a page belongs to: the longest matching address in the section. */
function activeHref(pathname: string, items: AttNavItem[], section: AttSection): string | null {
  const inSection = (href: string) => (section === "staff" ? !href.startsWith("/attendance/admin") : href.startsWith("/attendance/admin"));
  const hits = items.filter((i) => inSection(i.href) && (pathname === i.href || pathname.startsWith(`${i.href}/`)));
  return hits.sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
}

const row = (active: boolean) =>
  `flex min-h-10 items-center gap-2.5 border-l-2 pl-4 pr-3 text-sm font-semibold transition-colors ${
    active ? "border-[var(--att-blue)] bg-[var(--att-blue-tint)] text-[var(--att-blue)]" : "border-transparent text-ink hover:bg-alt"
  }`;

/** The section's sidebar (laptop and up; on a phone the staff app uses the bottom bar, the admin app the menu button). */
export function AttSidebar({ section, roles, badges = {} }: { section: AttSection; roles: AttRole[]; badges?: Record<string, number> }) {
  const pathname = usePathname();
  const { navRef, indicator } = useSlidingIndicator();
  const items = navFor(section, roles);
  const on = activeHref(pathname, items, section);
  return (
    <nav ref={navRef} aria-label={ATT_NAV[section].title} className="relative rounded-[12px] border border-gray-200 bg-white py-3">
      {indicator}
      <HubBackLink />
      <p className="px-4 pb-2 text-[0.66rem] font-bold uppercase tracking-widest text-subtle">{ATT_NAV[section].title}</p>
      <ul>
        {items.map((i) => {
          const I = ICONS[i.icon];
          const n = badges[i.href] ?? 0;
          return (
            <li key={i.href}>
              <Link href={i.href} aria-current={on === i.href ? "page" : undefined} className={row(on === i.href)}>
                <I size={16} aria-hidden />
                <span className="flex-1 py-2">{i.label}</span>
                {n > 0 && <span className="rounded-full bg-[var(--att-amber)] px-2 py-0.5 text-[0.7rem] font-bold text-white">{n}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The staff app's bottom bar on a phone: Home, Leave, Time, More. */
export function AttBottomNav({ roles, badges = {} }: { roles: AttRole[]; badges?: Record<string, number> }) {
  const pathname = usePathname();
  const items = navFor("staff", roles).filter((i) => !i.adminOnly);
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
            {n > 0 && <span className="absolute right-[28%] top-1 h-2 w-2 rounded-full bg-[var(--att-amber)]" aria-label={`${n} waiting`} />}
          </Link>
        );
      })}
    </nav>
  );
}
