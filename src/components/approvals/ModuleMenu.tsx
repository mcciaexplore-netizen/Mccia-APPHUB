"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { NotificationBell } from "@/components/approvals/NotificationBell";
import {
  approvalsApps, canSee, isGroup, resolveApp, type AppKey, type ApprovalsRole, type NavEntry, type NavGroup, type NavItem,
} from "@/lib/approvals/approvals.manifest";

const TAB = "whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-all duration-200";
const on = "bg-blue-tint text-primary";
const off = "text-muted hover:bg-blue-tint hover:text-primary";

/**
 * The top of every Approval System page: the application's name, the bell, a row of section tabs (the same look as the Administrator
 * tabs) and, under it, the pages of the chosen section. Which application it shows follows the page. The page itself is drawn by the
 * layout, outside this component, so a page that is not found or redirects still answers with a real 404 or redirect.
 */
export function ModuleMenu({
  roles, apps, unread, waiting, pendingForMe,
}: { roles: ApprovalsRole[]; apps: AppKey[]; unread: number; waiting: number; pendingForMe: number }) {
  const pathname = usePathname();
  const appParam = useSearchParams().get("app");
  const app = approvalsApps.find((a) => a.key === resolveApp(pathname, appParam, roles, apps))!;

  // Only what this person's roles allow, and no section left empty. A section left with a single page (a plain requester's one form)
  // becomes that page's own tab, so there is no row of pages with one link in it.
  const entries = app.nav
    .map((e): NavEntry | null => {
      if (!canSee(e, roles)) return null;
      if (!isGroup(e)) return e;
      const items = e.items.filter((i) => canSee(i, roles));
      if (items.length === 1) return items[0];
      return items.length ? { ...e, items } : null;
    })
    .filter((e): e is NavEntry => !!e);

  // The page you are on: the longest menu link that matches the address.
  const links = entries.flatMap((e) => (isGroup(e) ? e.items : [e])).filter((i) => i.href && !i.disabled);
  const activeHref = links
    .map((i) => i.href!)
    .filter((h) => pathname === h || pathname.startsWith(`${h}/`))
    .sort((a, b) => b.length - a.length)[0];
  const activeGroup = entries.find((e): e is NavGroup => isGroup(e) && e.items.some((i) => i.href === activeHref));

  // The red count: what is waiting for the Director General on the Recommended Queue, and what is waiting for an approver on their pending page.
  const pill = (n: number) => <span className="ml-2 rounded-pill bg-brand-red px-1.5 text-[0.68rem] font-bold leading-5 text-white">{n > 99 ? "99+" : n}</span>;
  const badge = (label: string) => {
    if (label === "Recommended Queue" && waiting > 0) return pill(waiting);
    if ((label === "Pending Approvals" || label === "Waiting for Me") && pendingForMe > 0) return pill(pendingForMe);
    return null;
  };

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl text-ink sm:text-3xl">{app.title}</h1>
        <NotificationBell initialUnread={unread} />
      </div>

      <nav className="mt-5 flex gap-2 overflow-x-auto border-b border-line pb-3" aria-label={`${app.title} sections`}>
        {entries.map((e) => {
          if (isGroup(e)) {
            return (
              <Link key={e.label} href={e.items[0].href!} aria-current={e === activeGroup ? "true" : undefined} className={`${TAB} ${e === activeGroup ? on : off}`}>{e.label}{e.items.map((i) => badge(i.label)).find(Boolean)}</Link>
            );
          }
          const item = e as NavItem;
          if (item.disabled) {
            return (
              <span key={item.label} aria-disabled="true" className={`${TAB} cursor-not-allowed text-subtle opacity-70`}>
                {item.label} <span className="ml-1 rounded-pill bg-[var(--z-amber-tint)] px-1.5 py-0.5 text-[0.6rem] font-bold uppercase text-[var(--z-amber)]">Coming soon</span>
              </span>
            );
          }
          return (
            <Link key={item.label} href={item.href!} aria-current={item.href === activeHref ? "page" : undefined} className={`${TAB} ${item.href === activeHref ? on : off}`}>
              {item.label}{badge(item.label)}
            </Link>
          );
        })}
      </nav>

      {activeGroup && (
        <nav className="flex gap-1.5 overflow-x-auto border-b border-line py-2.5 sm:flex-wrap sm:overflow-visible" aria-label={`${activeGroup.label} pages`}>
          {activeGroup.items.map((i) => (
            <Link
              key={i.href} href={i.href!} aria-current={i.href === activeHref ? "page" : undefined}
              className={`whitespace-nowrap rounded-pill px-3.5 py-1.5 text-[0.82rem] transition-colors duration-200 ${i.href === activeHref ? "bg-primary font-semibold text-white" : "text-muted hover:bg-blue-tint hover:text-primary"}`}
            >
              {i.label}{badge(i.label)}
            </Link>
          ))}
        </nav>
      )}

    </>
  );
}
