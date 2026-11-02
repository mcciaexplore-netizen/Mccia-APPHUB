"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HubBackLink } from "@/components/BackLink";
import { useSlidingIndicator } from "@/components/SlidingIndicator";
import { DESIGN_NAV, navFor, type DesignRole, type DesignSection } from "@/lib/design/design.manifest";

const row = (active: boolean) =>
  `flex min-h-10 items-center gap-2 border-l-2 pl-4 pr-3 text-sm font-semibold transition-colors ${
    active ? "border-[#003F8A] bg-[rgba(0,63,138,0.07)] text-[#003F8A]" : "border-transparent text-ink hover:bg-alt"
  }`;

/** One DesignDesk section's sidebar (the same shape as IVR-CRM's and Cab Booking's): back to the hub, the section's name, its pages. */
export function DesignSidebar({ section, roles, pending = 0 }: { section: DesignSection; roles: DesignRole[]; pending?: number }) {
  const pathname = usePathname();
  const { navRef, indicator } = useSlidingIndicator();
  const items = navFor(section, roles);
  const home = DESIGN_NAV[section].items[0].href;
  const matches = (href: string) => pathname === href || (href !== home && pathname.startsWith(`${href}/`));
  const active = (href: string) => matches(href) && !items.some((o) => o.href.length > href.length && matches(o.href));
  return (
    <nav ref={navRef} aria-label={DESIGN_NAV[section].title} className="relative rounded-[12px] border border-gray-200 bg-white py-3">
      {indicator}
      <HubBackLink />
      <p className="px-4 pb-2 text-[0.66rem] font-bold uppercase tracking-widest text-subtle">{DESIGN_NAV[section].title}</p>
      <ul>
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} aria-current={active(i.href) ? "page" : undefined} className={row(active(i.href))}>
              <span className="flex-1 py-2">{i.label}</span>
              {i.badge === "pending" && pending > 0 && (
                <span className="rounded-full bg-[#dc2626] px-2 py-0.5 text-[0.7rem] font-bold text-white" aria-label={`${pending} waiting`}>
                  {pending}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
