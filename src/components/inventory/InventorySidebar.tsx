"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HubBackLink } from "@/components/BackLink";
import { useSlidingIndicator } from "@/components/SlidingIndicator";
import { navFor, type InventoryRole } from "@/lib/inventory/inventory.manifest";

const row = (active: boolean) =>
  `flex min-h-10 items-center gap-2 border-l-2 pl-4 pr-3 text-sm font-semibold transition-colors ${
    active ? "border-[#2a6b7c] bg-[#f0f7f9] text-primary" : "border-transparent text-ink hover:bg-alt"
  }`;

/**
 * The Inventory module's own sidebar: what this person's roles let them open, with the pages not built yet greyed out. Under its heading,
 * the person's branch (whose stock they see), or "No branch assigned" in amber.
 */
export function InventorySidebar({ roles, branchName }: { roles: InventoryRole[]; branchName: string | null }) {
  const pathname = usePathname();
  const { navRef, indicator } = useSlidingIndicator();
  // A section stays highlighted on its own pages (a purchase order under Purchase orders); the dashboard only on itself.
  const active = (href: string) => pathname === href || (href !== "/inventory" && pathname.startsWith(`${href}/`));
  return (
    <nav ref={navRef} aria-label="Inventory" className="relative rounded-[14px] border border-gray-200 bg-white py-3">
      {indicator}
      <HubBackLink />
      <p className="px-4 text-[0.66rem] font-bold uppercase tracking-widest text-subtle">Inventory</p>
      <p className={`px-4 pb-2 text-xs ${branchName ? "text-muted" : "font-semibold text-[#b45309]"}`}>{branchName ? `Branch: ${branchName}` : "No branch assigned"}</p>
      <ul>
        {navFor(roles).map((i) => (
          <li key={i.href}>
            {i.disabled ? (
              <span className="flex min-h-10 cursor-default items-center gap-2 border-l-2 border-transparent pl-4 pr-3 text-sm font-semibold text-subtle" aria-disabled="true">
                <span className="flex-1 py-2">{i.label}</span>
                <span className="rounded-pill bg-alt px-2 text-[0.65rem] font-semibold leading-5 text-muted">Coming soon</span>
              </span>
            ) : (
              <Link href={i.href} aria-current={active(i.href) ? "page" : undefined} className={row(active(i.href))}>
                <span className="flex-1 py-2">{i.label}</span>
              </Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
