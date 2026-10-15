"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const BASE = "/administrator/users";
const items = [
  { href: BASE, label: "People", match: (p: string) => !p.startsWith(`${BASE}/org`) && !p.startsWith(`${BASE}/audit`) },
  { href: `${BASE}/org`, label: "Branches & teams", match: (p: string) => p.startsWith(`${BASE}/org`) },
  { href: `${BASE}/audit`, label: "Audit log", match: (p: string) => p.startsWith(`${BASE}/audit`) },
  { href: "/administrator/access", label: "By application & templates", match: () => false },
];

/** The pages inside Users & Access. */
export function PeopleNav() {
  const p = usePathname();
  return (
    <nav className="mb-6 flex gap-1.5 overflow-x-auto" aria-label="Users and access pages">
      {items.map((i) => {
        const on = i.match(p);
        return (
          <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined}
            className={`whitespace-nowrap rounded-pill px-3.5 py-1.5 text-[0.82rem] transition-colors duration-200 ${on ? "bg-primary font-semibold text-white" : "text-muted hover:bg-blue-tint hover:text-primary"}`}>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
