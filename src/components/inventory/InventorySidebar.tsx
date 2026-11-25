"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Building2, ChevronDown, ClipboardList, LayoutDashboard, Package, Wrench, type LucideIcon } from "lucide-react";
import { HubBackLink } from "@/components/BackLink";
import { useSlidingIndicator } from "@/components/SlidingIndicator";
import { isNavGroup, navFor, type InventoryNavItem, type InventoryRole } from "@/lib/inventory/inventory.manifest";

const ICON: Record<string, LucideIcon> = { Dashboard: LayoutDashboard, Inventory: Package, Vendors: Building2, Maintenance: Wrench, "Audit Log": ClipboardList };

const row = (active: boolean) =>
  `flex min-h-10 items-center gap-2 border-l-2 pl-4 pr-3 text-sm font-semibold transition-colors ${
    active ? "border-[#2a6b7c] bg-[#f0f7f9] text-primary" : "border-transparent text-ink hover:bg-alt"
  }`;

/**
 * The Inventory module's own sidebar: what this person's roles let them open. Inventory and Maintenance are collapsible: a click opens or
 * closes them, and the one holding the page open starts open. Under its heading, the person's branch (whose stock they see), or "No branch
 * assigned" in amber. On a phone the whole menu sits behind one button (MobileMenu).
 */
export function InventorySidebar({ roles, branchName }: { roles: InventoryRole[]; branchName: string | null }) {
  const pathname = usePathname();
  const { navRef, indicator } = useSlidingIndicator();
  // What the person opened or closed by hand; a group they have not touched is open exactly when it holds the page they are on.
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  // A section stays highlighted on its own pages (a purchase order under Purchase Orders); the dashboard only on itself.
  const active = (href: string) => pathname === href || (href !== "/inventory" && pathname.startsWith(`${href}/`));

  const link = (i: InventoryNavItem, nested = false) => {
    const Icon = nested ? undefined : ICON[i.label];
    return i.disabled ? (
      <span className={`flex min-h-10 cursor-default items-center gap-2 border-l-2 border-transparent pr-3 text-sm font-semibold text-subtle ${nested ? "pl-9" : "pl-4"}`} aria-disabled="true">
        <span className="flex-1 py-2">{i.label}</span>
        <span className="rounded-pill bg-alt px-2 text-[0.65rem] font-semibold leading-5 text-muted">Coming soon</span>
      </span>
    ) : (
      <Link href={i.href} aria-current={active(i.href) ? "page" : undefined} className={`${row(active(i.href))} ${nested ? "!pl-9" : ""}`}>
        {Icon && <Icon size={15} aria-hidden className="shrink-0" />}
        <span className="flex-1 py-2">{i.label}</span>
      </Link>
    );
  };

  return (
    <nav ref={navRef} aria-label="Inventory" className="relative rounded-[14px] border border-gray-200 bg-white py-3">
      {indicator}
      <HubBackLink />
      <p className="px-4 text-[0.66rem] font-bold uppercase tracking-widest text-subtle">Inventory</p>
      <p className={`px-4 pb-2 text-xs ${branchName ? "text-muted" : "font-semibold text-[#b45309]"}`}>{branchName ? `Branch: ${branchName}` : "No branch assigned"}</p>
      <ul>
        {navFor(roles).map((e) => {
          if (!isNavGroup(e)) return <li key={e.href}>{link(e)}</li>;
          const holdsPage = e.children.some((c) => !c.disabled && active(c.href));
          const open = chosen[e.label] ?? holdsPage;
          const Icon = ICON[e.label];
          const id = `inv-nav-${e.label.toLowerCase()}`;
          return (
            <li key={e.label}>
              <button
                type="button"
                aria-expanded={open}
                aria-controls={id}
                onClick={() => setChosen((c) => ({ ...c, [e.label]: !open }))}
                // Closed with the current page inside: the heading itself carries the highlight, since the line that would is hidden.
                className={`${row(!open && holdsPage)} w-full text-left`}
              >
                {Icon && <Icon size={15} aria-hidden className="shrink-0" />}
                <span className="flex-1 py-2">{e.label}</span>
                <ChevronDown size={15} aria-hidden className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
              </button>
              {open && (
                <ul id={id}>
                  {e.children.map((c) => (
                    <li key={c.href}>{link(c, true)}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
