"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The pages inside Users & Access that this person may open. The tab list comes from the server (see peopleTabsFor), as match functions cannot cross to the browser. */
export function PeopleNav({ show }: { show: ("People" | "Branches & teams" | "Audit log" | "By application & templates")[] }) {
  const p = usePathname();
  const BASE = "/administrator/users";
  const all = [
    { href: BASE, label: "People", match: (q: string) => !q.startsWith(`${BASE}/org`) && !q.startsWith(`${BASE}/audit`) },
    { href: `${BASE}/org`, label: "Branches & teams", match: (q: string) => q.startsWith(`${BASE}/org`) },
    { href: `${BASE}/audit`, label: "Audit log", match: (q: string) => q.startsWith(`${BASE}/audit`) },
    { href: "/administrator/access", label: "By application & templates", match: () => false },
  ] as const;
  const items = all.filter((i) => (show as readonly string[]).includes(i.label));
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
