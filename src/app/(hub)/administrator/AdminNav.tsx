"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/administrator/departments", label: "Departments" },
  { href: "/administrator/users", label: "Users" },
  { href: "/administrator/notifications", label: "Notifications Panel" },
  { href: "/administrator/access", label: "Access" },
  { href: "/administrator/activity", label: "Activity log" },
];

export function AdminNav() {
  const p = usePathname();
  return (
    <nav className="mb-8 mt-5 flex gap-2 overflow-x-auto border-b border-line pb-3" aria-label="Administrator sections">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href}
          className={`whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-all duration-200 ${
            p.startsWith(t.href) ? "bg-blue-tint text-primary" : "text-muted hover:bg-blue-tint hover:text-primary"}`}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
