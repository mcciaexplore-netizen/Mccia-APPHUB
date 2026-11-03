"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
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
  const sectionParam = useSearchParams().get("section");
  const { navRef, indicator } = useSlidingIndicator();
  const items = navFor(section, roles);
  const home = DESIGN_NAV[section].items[0].href;
  const matches = (href: string) => pathname === href || (href !== home && pathname.startsWith(`${href}/`));
  // A line with sub-lines is the current page only when none of them is (a sub-line is its page plus ?section=).
  const childActive = (href: string) => { const u = new URL(href, "http://x"); return pathname === u.pathname && sectionParam === u.searchParams.get("section"); };
  const active = (href: string) =>
    matches(href) && !items.some((o) => o.href.length > href.length && matches(o.href)) && !items.find((o) => o.href === href)?.children?.some((c) => childActive(c.href));
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
            {/* The sub-lines (the library's sections) show only while on that page, nested under it with a guide line. */}
            {i.children && matches(i.href) && (
              <ul aria-label={`${i.label} sections`} className="mb-1 ml-6 border-l border-gray-200">
                {i.children.map((c) => {
                  const on = childActive(c.href);
                  return (
                    <li key={c.href}>
                      <Link
                        href={c.href}
                        aria-current={on ? "page" : undefined}
                        className={`-ml-px flex min-h-8 items-center border-l-2 pl-4 pr-3 text-[0.82rem] transition-colors ${on ? "border-[#003F8A] font-semibold text-[#003F8A]" : "border-transparent font-medium text-subtle hover:border-gray-300 hover:text-ink"}`}
                      >
                        <span className="flex-1 py-1.5">{c.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
