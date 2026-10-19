"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** One line of the Approval System sidebar, with the lines under it (HR under Approval Forms, Pending under HR, ...). */
export type SideLink = { label: string; href: string; waiting?: number; children?: SideLink[] };

const row = (active: boolean, depth: number) =>
  `flex min-h-10 items-center gap-2 border-l-2 pr-3 text-sm transition-colors ${depth === 0 ? "pl-4 font-semibold" : depth === 1 ? "pl-8 font-medium" : "pl-12"} ${
    active ? "border-[#2a6b7c] bg-[#f0f7f9] text-primary" : "border-transparent text-ink hover:bg-alt"
  }`;

function Line({ link, depth, pathname }: { link: SideLink; depth: number; pathname: string }) {
  // A line is highlighted for its own page, not when one of the lines under it is the page open (HR opens on its Pending list).
  const active = pathname === link.href && !link.children?.some((c) => c.href === pathname);
  return (
    <li>
      <Link href={link.href} aria-current={active ? "page" : undefined} className={row(active, depth)}>
        <span className="flex-1 py-2">{link.label}</span>
        {!!link.waiting && <span className="rounded-pill bg-brand-red px-1.5 text-[0.68rem] font-bold leading-5 text-white">{link.waiting > 99 ? "99+" : link.waiting}</span>}
      </Link>
      {link.children && link.children.length > 0 && (
        <ul>{link.children.map((c) => <Line key={c.href} link={c} depth={depth + 1} pathname={pathname} />)}</ul>
      )}
    </li>
  );
}

/** The Approval System's own sidebar: what this person may open in it, and nothing else. */
export function ApprovalsSidebar({ links }: { links: SideLink[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Approval System" className="rounded-[14px] border border-gray-200 bg-white py-3">
      <p className="px-4 pb-2 text-[0.66rem] font-bold uppercase tracking-widest text-subtle">Approval System</p>
      <ul>{links.map((l) => <Line key={l.href} link={l} depth={0} pathname={pathname} />)}</ul>
    </nav>
  );
}
