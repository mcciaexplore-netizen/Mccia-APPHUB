"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Accessibility, ChevronDown, LogOut, X } from "lucide-react";
import { Icon } from "@/components/Icon";
import { NotificationBell } from "@/components/approvals/NotificationBell";
import {
  allNavItems, appOwning, approvalsApps, canSee, isGroup, type AppKey, type ApprovalsRole, type NavEntry, type NavGroup, type NavItem,
} from "@/lib/approvals/approvals.manifest";

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";

export function Sidebar({
  user, unread, waiting, large, onToggleLarge, signOut, onNavigate, onClose,
}: {
  user: { name: string; roles: ApprovalsRole[] };
  unread: number;
  waiting: number;
  large: boolean;
  onToggleLarge: () => void;
  signOut: () => Promise<void>;
  onNavigate: () => void;
  onClose: () => void;
}) {
  const pathname = usePathname();

  // Highlight the longest matching link, so /budgets/utilisation does not also light up /budgets.
  const activeHref = allNavItems()
    .map((i) => i.href!)
    .filter((h) => pathname === h || pathname.startsWith(`${h}/`))
    .sort((a, b) => b.length - a.length)[0];

  // Which of the two parts is showing: the one the page belongs to, unless the person just switched on this page. A page in neither
  // (the home screen, a request) shows the DG part, or the Expenditure part for someone who is only an approver of small expenses.
  const [pick, setPick] = useState<{ app: AppKey; path: string } | null>(null);
  const fallback: AppKey = user.roles.some((r) => r === "approvals_admin" || r === "dg" || r === "viewer") ? "dg" : user.roles.includes("approver") ? "exp" : "dg";
  const appKey: AppKey = pick && pick.path === pathname ? pick.app : appOwning(pathname) ?? fallback;
  const app = approvalsApps.find((a) => a.key === appKey)!;

  const entries = app.nav
    .map((e): NavEntry | null => {
      if (!canSee(e, user.roles)) return null;
      if (!isGroup(e)) return e;
      const items = e.items.filter((i) => canSee(i, user.roles));
      return items.length ? { ...e, items } : null;
    })
    .filter((e): e is NavEntry => !!e);

  const holdsActive = (g: NavGroup) => g.items.some((i) => i.href === activeHref);
  // A group is open when the person opened it, or (until they touch it) when it holds the current page, or is the first on the home screen.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const firstGroup = entries.find(isGroup);

  const badge = (label: string) => (label === "DG APPROVALS" && waiting > 0 ? (
    <span className="rounded-full bg-[var(--z-red)] px-1.5 text-[0.68rem] font-bold leading-5 text-white">{waiting > 99 ? "99+" : waiting}</span>
  ) : null);

  const link = (i: NavItem) => {
    const active = i.href === activeHref;
    return (
      <Link key={i.href} href={i.href!} onClick={onNavigate} aria-current={active ? "page" : undefined} className={`zs-row zs-sub ${active ? "zs-active" : ""}`}>
        <span className="flex-1 py-1">{i.label}</span>
      </Link>
    );
  };

  return (
    <aside className="zs flex h-full flex-col">
      <div className="zs-head shrink-0 space-y-2.5 px-3 pb-3 pt-3.5">
        <div className="flex items-center justify-between gap-2">
          <Link href="/approvals" onClick={onNavigate} className="zs-title min-w-0 flex-1 truncate">{app.title}</Link>
          <button className="text-white/80 lg:hidden" aria-label="Close menu" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="zs-switch" role="group" aria-label="Switch between the two parts of Approvals">
          {approvalsApps.map((a) => (
            <button key={a.key} type="button" aria-pressed={a.key === appKey} onClick={() => setPick({ app: a.key, path: pathname })}>{a.title}</button>
          ))}
        </div>
      </div>

      <Link href="/" className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--z-side-line)] px-4 text-xs text-white/65 transition-colors hover:text-white">
        <ArrowLeft size={14} /> Back to App Hub
      </Link>

      <nav className="apr-scroll flex-1 overflow-y-auto py-1" aria-label={app.title}>
        {entries.map((e) => {
          if (!isGroup(e)) {
            const withIcon = e as NavItem & { icon: string };
            if (e.disabled) {
              return (
                <div key={e.label} className="zs-row cursor-not-allowed opacity-50" aria-disabled="true">
                  <Icon name={withIcon.icon} size={18} /> <span className="flex-1 py-1.5">{e.label}</span>
                  <span className="zs-soon">Coming soon</span>
                </div>
              );
            }
            const active = e.href === activeHref;
            return (
              <Link key={e.label} href={e.href!} onClick={onNavigate} aria-current={active ? "page" : undefined} className={`zs-row ${active ? "zs-active" : ""}`}>
                <Icon name={withIcon.icon} size={18} /> <span className="flex-1 py-1.5">{e.label}</span> {badge(e.label)}
              </Link>
            );
          }
          const id = `${app.key}:${e.label}`;
          const isOpen = expanded[id] ?? (holdsActive(e) || (!activeHref && e === firstGroup));
          return (
            <div key={id}>
              <button type="button" aria-expanded={isOpen} onClick={() => setExpanded((s) => ({ ...s, [id]: !isOpen }))} className="zs-row w-full text-left">
                <Icon name={e.icon} size={18} /> <span className="flex-1 py-1.5">{e.label}</span>
                <ChevronDown size={15} className={`transition-transform duration-200 ${isOpen ? "rotate-180" : "-rotate-90"}`} />
              </button>
              {isOpen && <div className="bg-black/15">{e.items.map(link)}</div>}
            </div>
          );
        })}
      </nav>

      <div className="zs-foot flex shrink-0 items-center gap-1 px-3 py-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--z-teal)] text-xs font-bold" aria-hidden>{initials(user.name)}</span>
        <span className="min-w-0 flex-1 truncate px-1.5 text-sm font-bold" title={user.name}>{user.name}</span>
        <button type="button" onClick={onToggleLarge} aria-pressed={large} aria-label="Larger text" title={large ? "Normal text size" : "Larger text"} className="zs-icon-btn">
          <Accessibility size={18} />
        </button>
        <NotificationBell initialUnread={unread} />
        <form action={signOut}>
          <button aria-label="Sign out" title="Sign out" className="zs-icon-btn"><LogOut size={17} /></button>
        </form>
      </div>
    </aside>
  );
}
