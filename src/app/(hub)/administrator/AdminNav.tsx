"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import type { AdminTab } from "@/lib/admin-tabs";

/** The tabs this person may open (see adminTabsFor): everything for the two top roles, only the switched-on areas for an Admin. */
export function AdminNav({ tabs }: { tabs: AdminTab[] }) {
  const p = usePathname();
  return (
    <nav className="mb-8 mt-5 flex gap-2 overflow-x-auto border-b border-line pb-3" aria-label="Administrator sections">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href}
          className={`whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-all duration-200 ${
            (t.exact ? p === t.href : p.startsWith(t.label === "Users & Access" ? "/administrator/users" : t.href) || (t.label === "Users & Access" && p.startsWith("/administrator/access"))) ? "bg-blue-tint text-primary" : "text-muted hover:bg-blue-tint hover:text-primary"}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
