"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useSlidingIndicator } from "@/components/SlidingIndicator";
import { Activity, AppWindow, Bell, ClipboardCheck, LayoutDashboard, Settings2, UserCheck, Users, Wallet } from "lucide-react";
import type { AdminTab } from "@/lib/admin-tabs";

const ICON: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Dashboard: LayoutDashboard, Users, Applications: AppWindow, "Activity Log": Activity, "Approval Forms": ClipboardCheck, HR: UserCheck, Expenditure: Wallet, "Notification Panel": Bell,
};

const row = (active: boolean) =>
  `flex min-h-10 items-center gap-3 border-l-2 px-4 text-sm transition-colors ${active ? "border-[#2a6b7c] bg-[#f0f7f9] font-semibold text-primary" : "border-transparent text-ink hover:bg-alt"}`;

/** The Administrator sidebar: the main sections, then Settings & Administration. */
export function AdminSidebar({ tabs }: { tabs: AdminTab[] }) {
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");
  const { navRef, indicator } = useSlidingIndicator();
  const isActive = (t: { href: string; exact?: boolean }) => {
    const [path, query] = t.href.split("?");
    if (t.exact) return pathname === path;
    if (query) return pathname === path && tab === new URLSearchParams(query).get("tab");
    return pathname === path || pathname.startsWith(`${path}/`);
  };
  const line = (t: AdminTab) => {
    const Icon = ICON[t.label] ?? Settings2;
    // A line with lines under it (Approval Forms: HR, Expenditure) is a heading for them; the line of the page open is highlighted.
    const active = !t.children && isActive(t);
    return (
      <li key={t.label}>
        <Link href={t.href} aria-current={active ? "page" : undefined} className={row(active)}>
          <Icon size={16} className="shrink-0" /><span className="py-2">{t.label}</span>
        </Link>
        {t.children && (
          <ul>
            {t.children.map((c) => {
              // The most specific line wins: on Bulk add (/manage/import) only Bulk add is highlighted, not "Add & manage users" (/manage).
              const on = isActive(c) && !t.children!.some((x) => x.href.length > c.href.length && isActive(x));
              return <li key={c.href}><Link href={c.href} aria-current={on ? "page" : undefined} className={`${row(on)} pl-11`}><span className="py-2">{c.label}</span></Link></li>;
            })}
          </ul>
        )}
      </li>
    );
  };
  const heading = "mt-3 border-t border-line px-4 pb-2 pt-4 text-[0.66rem] font-bold uppercase tracking-widest text-subtle";
  return (
    <nav ref={navRef} aria-label="Administrator" className="relative rounded-[14px] border border-gray-200 bg-white py-3">
      {indicator}
      <ul>{tabs.filter((t) => t.group === "main").map((t) => line(t))}</ul>
      <p className={heading}>Settings &amp; Administration</p>
      <ul>{tabs.filter((t) => t.group === "settings").map((t) => line(t))}</ul>
    </nav>
  );
}
