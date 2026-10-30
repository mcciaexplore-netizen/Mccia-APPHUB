"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HubBackLink } from "@/components/BackLink";
import { useSlidingIndicator } from "@/components/SlidingIndicator";
import { CAB_NAV, flatNav, navFor, type CabNavItem, type CabRole, type CabSection } from "@/lib/cabs/cabs.manifest";

const row = (active: boolean, nested: boolean) =>
  `flex min-h-10 items-center gap-2 border-l-2 ${nested ? "pl-8" : "pl-4"} pr-3 text-sm ${nested ? "font-medium" : "font-semibold"} transition-colors ${
    active ? "border-[#2a6b7c] bg-[#f0f7f9] text-primary" : "border-transparent text-ink hover:bg-alt"
  }`;

/**
 * One Cab Booking section's sidebar (the same shape as Inventory's): back to the hub, the section's name, its pages, with nested lines
 * under their parent (Driver Activity under Drivers). `live`: rides in progress now, shown as a green dot on Live Trips.
 */
export function SectionSidebar({ section, roles, live = 0 }: { section: CabSection; roles: CabRole[]; live?: number }) {
  const pathname = usePathname();
  const { navRef, indicator } = useSlidingIndicator();
  const items = navFor(section, roles);
  const home = CAB_NAV[section].items[0].href;
  const all = flatNav(items);
  // The most specific line wins: on Driver Activity only that line is highlighted, not Drivers too. The dashboard only on itself.
  const matches = (href: string) => pathname === href || (href !== home && pathname.startsWith(`${href}/`));
  const active = (href: string) => matches(href) && !all.some((o) => o.href.length > href.length && matches(o.href));
  const line = (i: CabNavItem, nested: boolean) => (
    <li key={i.href}>
      <Link href={i.href} aria-current={active(i.href) ? "page" : undefined} className={row(active(i.href), nested)}>
        <span className="flex-1 py-2">{i.label}</span>
        {i.live && live > 0 && <span className="h-2.5 w-2.5 rounded-full bg-[#10b981] shadow-[0_0_0_3px_rgba(16,185,129,0.2)]" title={`${live} ${live === 1 ? "ride" : "rides"} in progress`} data-live-dot aria-label={`${live} in progress`} />}
      </Link>
      {i.children && <ul>{i.children.map((c) => line(c, true))}</ul>}
    </li>
  );
  return (
    <nav ref={navRef} aria-label={CAB_NAV[section].title} className="relative rounded-[14px] border border-gray-200 bg-white py-3">
      {indicator}
      <HubBackLink />
      <p className="px-4 pb-2 text-[0.66rem] font-bold uppercase tracking-widest text-subtle">{CAB_NAV[section].title}</p>
      <ul>{items.map((i) => line(i, false))}</ul>
    </nav>
  );
}
