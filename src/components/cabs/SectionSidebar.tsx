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

/**
 * One Cab Booking section's sidebar (the same shape as Inventory's): back to the hub, the section's name, its pages as one flat list.
 * `live`: rides in progress now (a green dot on Live Trips); `pending`: rides waiting for a driver (a red count on Pending Requests);
 * `loginRequests`: drivers waiting for a login OTP (an amber dot on Drivers).
 */
export function SectionSidebar({ section, roles, live = 0, pending = 0, loginRequests = 0 }: { section: CabSection; roles: CabRole[]; live?: number; pending?: number; loginRequests?: number }) {
  const pathname = usePathname();
  const { navRef, indicator } = useSlidingIndicator();
  const items = navFor(section, roles);
  const home = CAB_NAV[section].items[0].href;
  // The most specific line wins: on Driver Activity (/cabs/admin/drivers/activity) only that line is highlighted, not Drivers too; the
  // dashboard only on itself.
  const matches = (href: string) => pathname === href || (href !== home && pathname.startsWith(`${href}/`));
  const active = (href: string) => matches(href) && !items.some((o) => o.href.length > href.length && matches(o.href));
  return (
    <nav ref={navRef} aria-label={CAB_NAV[section].title} className="relative rounded-[14px] border border-gray-200 bg-white py-3">
      {indicator}
      <HubBackLink />
      <p className="px-4 pb-2 text-[0.66rem] font-bold uppercase tracking-widest text-subtle">{CAB_NAV[section].title}</p>
      <ul>
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} aria-current={active(i.href) ? "page" : undefined} className={row(active(i.href))}>
              <span className="flex-1 py-2">{i.label}</span>
              {i.live && live > 0 && <span className="h-2.5 w-2.5 rounded-full bg-[#10b981] shadow-[0_0_0_3px_rgba(16,185,129,0.2)]" title={`${live} ${live === 1 ? "ride" : "rides"} in progress`} data-live-dot aria-label={`${live} in progress`} />}
              {i.badge === "pending" && pending > 0 && <span className="min-w-6 rounded-full bg-brand-red px-1.5 py-0.5 text-center text-xs font-bold text-white" data-pending-badge aria-label={`${pending} waiting`}>{pending}</span>}
              {i.badge === "login" && loginRequests > 0 && <span className="h-2.5 w-2.5 rounded-full bg-[#f59e0b] shadow-[0_0_0_3px_rgba(245,158,11,0.2)]" title={`${loginRequests} ${loginRequests === 1 ? "driver is" : "drivers are"} waiting for a login OTP`} data-login-dot aria-label={`${loginRequests} waiting for a login OTP`} />}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
