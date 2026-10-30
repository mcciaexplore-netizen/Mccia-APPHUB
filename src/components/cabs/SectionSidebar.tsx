"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HubBackLink } from "@/components/BackLink";
import { useSlidingIndicator } from "@/components/SlidingIndicator";
import { CAB_NAV, navFor, type CabRole, type CabSection } from "@/lib/cabs/cabs.manifest";

const row = (active: boolean) =>
  `flex min-h-10 items-center gap-2 border-l-2 pl-4 pr-3 text-sm font-semibold transition-colors ${
    active ? "border-[#2a6b7c] bg-[#f0f7f9] text-primary" : "border-transparent text-ink hover:bg-alt"
  }`;

/** One Cab Booking section's sidebar (the same shape as Inventory's): back to the hub, the section's name, its pages. */
export function SectionSidebar({ section, roles }: { section: CabSection; roles: CabRole[] }) {
  const pathname = usePathname();
  const { navRef, indicator } = useSlidingIndicator();
  const home = CAB_NAV[section].items[0].href;
  // A page stays highlighted on its own sub-pages; the section's dashboard only on itself.
  const active = (href: string) => pathname === href || (href !== home && pathname.startsWith(`${href}/`));
  return (
    <nav ref={navRef} aria-label={CAB_NAV[section].title} className="relative rounded-[14px] border border-gray-200 bg-white py-3">
      {indicator}
      <HubBackLink />
      <p className="px-4 pb-2 text-[0.66rem] font-bold uppercase tracking-widest text-subtle">{CAB_NAV[section].title}</p>
      <ul>
        {navFor(section, roles).map((i) => (
          <li key={i.href}>
            <Link href={i.href} aria-current={active(i.href) ? "page" : undefined} className={row(active(i.href))}><span className="flex-1 py-2">{i.label}</span></Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
