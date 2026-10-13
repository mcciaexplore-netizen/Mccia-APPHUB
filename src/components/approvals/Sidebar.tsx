"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Bell, ChevronDown, LogOut, X } from "lucide-react";
import { Icon } from "@/components/Icon";
import {
  allNavItems, approvalsManifest, canSee, isGroup, type ApprovalsRole, type NavEntry, type NavGroup, type NavItem,
} from "@/lib/approvals/approvals.manifest";

const ROLE_LABEL: Record<ApprovalsRole, string> = {
  requester: "Requester", approver: "Approver", dg: "Director General", viewer: "Viewer", approvals_admin: "Approvals admin",
};
/** The most senior role shown under the person's name. */
const TOP_ROLE: ApprovalsRole[] = ["approvals_admin", "dg", "approver", "viewer", "requester"];

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";

const ROW = "flex min-h-11 items-center gap-3 px-4 text-[0.82rem] font-medium transition-colors duration-150";

export function Sidebar({
  user, signOut, onNavigate, onClose,
}: {
  user: { name: string; roles: ApprovalsRole[] };
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

  const entries = approvalsManifest.nav
    .map((e): NavEntry | null => {
      if (!isGroup(e)) return canSee(e, user.roles) ? e : null;
      const items = e.items.filter((i) => canSee(i, user.roles));
      return items.length ? { ...e, items } : null;
    })
    .filter((e): e is NavEntry => !!e);

  const holdsActive = (g: NavGroup) => g.items.some((i) => i.href === activeHref);
  const [open, setOpen] = useState<Set<string>>(() => {
    const first = entries.find(isGroup);
    return new Set(entries.filter(isGroup).filter(holdsActive).map((g) => g.label).concat(first && !activeHref ? [first.label] : []));
  });
  const toggle = (label: string) => setOpen((s) => { const n = new Set(s); if (n.has(label)) n.delete(label); else n.add(label); return n; });

  const link = (i: NavItem, indent: boolean) => {
    const active = i.href === activeHref;
    return (
      <Link
        key={i.href} href={i.href!} onClick={onNavigate} aria-current={active ? "page" : undefined}
        className={`${ROW} ${indent ? "pl-11 text-[0.8rem]" : ""} ${active ? "bg-brand-green-text text-white" : "text-white/80 hover:bg-(--apr-side-hover) hover:text-white"}`}
      >
        <span className="flex-1 py-1.5">{i.label}</span>
      </Link>
    );
  };

  const top = TOP_ROLE.find((r) => user.roles.includes(r)) ?? "requester";

  return (
    <aside className="flex h-full w-64 flex-col bg-(--apr-side) text-white">
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-(--apr-side-line) px-4">
        <Link href={approvalsManifest.basePath} onClick={onNavigate} className="block leading-tight">
          <span className="block font-heading text-lg font-extrabold tracking-tight">MCCIA</span>
          <span className="block text-[0.62rem] font-bold uppercase tracking-widest text-white/60">{approvalsManifest.name}</span>
        </Link>
        <button className="text-white/80 lg:hidden" aria-label="Close menu" onClick={onClose}><X size={20} /></button>
      </div>

      <Link href="/" className="flex h-10 shrink-0 items-center gap-2 border-b border-(--apr-side-line) px-4 text-xs text-white/70 transition-colors hover:text-white">
        <ArrowLeft size={14} /> Back to App Hub
      </Link>

      <nav className="apr-scroll flex-1 overflow-y-auto py-1" aria-label="Approvals">
        {entries.map((e) => {
          if (!isGroup(e)) {
            const withIcon = e as NavItem & { icon: string };
            if (e.disabled) {
              return (
                <div key={e.label} className={`${ROW} cursor-not-allowed text-white/40`} aria-disabled="true">
                  <Icon name={withIcon.icon} size={18} />
                  <span className="flex-1 whitespace-nowrap py-1.5">{e.label}</span>
                  <span className="shrink-0 whitespace-nowrap rounded-pill bg-(--apr-amber) px-1.5 py-0.5 text-[0.55rem] font-bold uppercase tracking-wide text-black/70">Coming soon</span>
                </div>
              );
            }
            const active = e.href === activeHref;
            return (
              <Link key={e.label} href={e.href!} onClick={onNavigate} aria-current={active ? "page" : undefined}
                className={`${ROW} ${active ? "bg-brand-green-text text-white" : "text-white/90 hover:bg-(--apr-side-hover)"}`}>
                <Icon name={withIcon.icon} size={18} /> <span className="flex-1 py-1.5">{e.label}</span>
              </Link>
            );
          }
          const isOpen = open.has(e.label) || holdsActive(e);
          return (
            <div key={e.label}>
              <button
                type="button" onClick={() => toggle(e.label)} aria-expanded={isOpen}
                className={`${ROW} w-full text-left text-white/90 hover:bg-(--apr-side-hover)`}
              >
                <Icon name={e.icon} size={18} /> <span className="flex-1 py-1.5">{e.label}</span>
                <ChevronDown size={15} className={`transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
              </button>
              {isOpen && <div className="bg-black/15">{e.items.map((i) => link(i, true))}</div>}
            </div>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-(--apr-side-line) p-3">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-green-text text-xs font-bold" aria-hidden>{initials(user.name)}</span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-semibold">{user.name}</p>
            <p className="truncate text-[0.7rem] text-white/60">{ROLE_LABEL[top]}</p>
          </div>
          <button type="button" aria-label="Notifications" title="Notifications" className="rounded-md p-2 text-white/70 transition-colors hover:bg-(--apr-side-hover) hover:text-white">
            <Bell size={17} />
          </button>
          <form action={signOut}>
            <button aria-label="Sign out" title="Sign out" className="rounded-md p-2 text-white/70 transition-colors hover:bg-(--apr-side-hover) hover:text-white"><LogOut size={17} /></button>
          </form>
        </div>
      </div>
    </aside>
  );
}
