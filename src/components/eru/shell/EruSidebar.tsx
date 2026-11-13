"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HubBackLink } from "@/components/BackLink";
import { useSlidingIndicator } from "@/components/SlidingIndicator";
import { ERU_NAV, navFor, type EruRole, type EruSection } from "@/lib/eru/eru.manifest";

const row = (active: boolean) =>
  `flex min-h-10 items-center gap-2 border-l-2 pl-4 pr-3 text-sm font-semibold transition-colors ${
    active ? "border-[#0F4C75] bg-[rgba(15,76,117,0.07)] text-[#0F4C75]" : "border-transparent text-ink hover:bg-alt"
  }`;

/** One ERU section's sidebar (the same shape as the other modules'): back to the hub, the section's name, its pages. */
export function EruSidebar({ section, roles, pending = 0 }: { section: EruSection; roles: EruRole[]; pending?: number }) {
  const pathname = usePathname();
  const { navRef, indicator } = useSlidingIndicator();
  const items = navFor(section, roles);
  const home = ERU_NAV[section].items[0].href;
  const inSection = (href: string) => (section === "workspace" ? !href.startsWith("/eru/admin") : href.startsWith("/eru/admin"));
  const matches = (href: string) => pathname === href || (href !== home && pathname.startsWith(`${href}/`));
  const active = (href: string) => inSection(href) && matches(href) && !items.some((o) => o.href.length > href.length && matches(o.href));
  const homeActive = !items.some((i) => i.href !== home && active(i.href)) && (pathname === home || (section === "workspace" && /^\/eru\/(domains|projects)\//.test(pathname)));
  return (
    <nav ref={navRef} aria-label={ERU_NAV[section].title} className="relative rounded-[12px] border border-gray-200 bg-white py-3">
      {indicator}
      <HubBackLink />
      <p className="px-4 pb-2 text-[0.66rem] font-bold uppercase tracking-widest text-subtle">{ERU_NAV[section].title}</p>
      <ul>
        {items.map((i) => {
          const on = i.href === home ? homeActive : active(i.href);
          return (
            <li key={i.href}>
              <Link href={i.href} aria-current={on ? "page" : undefined} className={row(on)}>
                <span className="flex-1 py-2">{i.label}</span>
                {i.href === "/eru/admin" && section === "admin" && pending > 0 && (
                  <span className="rounded-full bg-[#7c3aed] px-2 py-0.5 text-[0.7rem] font-bold text-white" title="Tracked changes waiting for review">
                    {pending}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
