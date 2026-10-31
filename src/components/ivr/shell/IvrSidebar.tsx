"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HubBackLink } from "@/components/BackLink";
import { useSlidingIndicator } from "@/components/SlidingIndicator";
import { IVR_NAV, navFor, type IvrRole, type IvrSection } from "@/lib/ivr/ivr.manifest";

const row = (active: boolean) =>
  `flex min-h-10 items-center gap-2 border-l-2 pl-4 pr-3 text-sm font-semibold transition-colors ${
    active ? "border-[#2a6b7c] bg-[#f0f7f9] text-primary" : "border-transparent text-ink hover:bg-alt"
  }`;

/** One IVR-CRM section's sidebar (the same shape as Cab Booking's and Inventory's): back to the hub, the section's name, its pages. */
export function IvrSidebar({ section, roles }: { section: IvrSection; roles: IvrRole[] }) {
  const pathname = usePathname();
  const { navRef, indicator } = useSlidingIndicator();
  const items = navFor(section, roles);
  const home = IVR_NAV[section].items[0].href;
  // The most specific line wins, and the section's home only on itself.
  const matches = (href: string) => pathname === href || (href !== home && pathname.startsWith(`${href}/`));
  const active = (href: string) => matches(href) && !items.some((o) => o.href.length > href.length && matches(o.href));
  return (
    <nav ref={navRef} aria-label={IVR_NAV[section].title} className="relative rounded-[14px] border border-gray-200 bg-white py-3">
      {indicator}
      <HubBackLink />
      <p className="px-4 pb-2 text-[0.66rem] font-bold uppercase tracking-widest text-subtle">{IVR_NAV[section].title}</p>
      <ul>
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} aria-current={active(i.href) ? "page" : undefined} className={row(active(i.href))}>
              <span className="flex-1 py-2">{i.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
