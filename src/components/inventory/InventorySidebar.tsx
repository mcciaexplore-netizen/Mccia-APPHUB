"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navFor, type InventoryRole } from "@/lib/inventory/inventory.manifest";

const row = (active: boolean) =>
  `flex min-h-10 items-center gap-2 border-l-2 pl-4 pr-3 text-sm font-semibold transition-colors ${
    active ? "border-[#2a6b7c] bg-[#f0f7f9] text-primary" : "border-transparent text-ink hover:bg-alt"
  }`;

/** The Inventory module's own sidebar: what this person's roles let them open, with the pages not built yet greyed out. */
export function InventorySidebar({ roles, canManageRoles = false }: { roles: InventoryRole[]; canManageRoles?: boolean }) {
  const pathname = usePathname();
  // A section stays highlighted on its own pages (a purchase order under Purchase orders); the dashboard only on itself.
  const active = (href: string) => pathname === href || (href !== "/inventory" && pathname.startsWith(`${href}/`));
  return (
    <nav aria-label="Inventory" className="rounded-[14px] border border-gray-200 bg-white py-3">
      <p className="px-4 pb-2 text-[0.66rem] font-bold uppercase tracking-widest text-subtle">Inventory</p>
      <ul>
        {navFor(roles, canManageRoles).map((i) => (
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
