"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PAGES_SEEN } from "@/components/HubShell";

/**
 * "← Back" at the top of a page, to the page it belongs under. With `history`, it goes back to the page the person came from inside the hub
 * (the list a request was opened from), and to `href` when they arrived from somewhere else (a notification, a link in an email).
 */
export function BackLink({ href, label = "Back", history = false }: { href: string; label?: string; history?: boolean }) {
  const router = useRouter();
  const onClick = (e: React.MouseEvent) => {
    if (!history) return;
    let cameFromHub = false;
    try { cameFromHub = Number(sessionStorage.getItem(PAGES_SEEN) ?? "0") > 1; } catch {}
    if (cameFromHub && window.history.length > 1) { e.preventDefault(); router.back(); }
  };
  return (
    <Link href={href} onClick={onClick} className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-primary">
      <ArrowLeft size={14} aria-hidden /> {label}
    </Link>
  );
}

/**
 * The back link on Administrator's own section pages (Dashboard, Users, ...), which goes home. Pages inside a section that already have
 * their own back link (a person, a category, an application's access, bulk add) get none here, so there is never two.
 */
const HAS_OWN_BACK = /^\/administrator\/((users|manage)\/import|(users|manage)\/[0-9a-f-]{36}|users\/org|departments\/[0-9a-f-]{36}|access\/app\/[0-9a-f-]{36})/;

export function AdminBackLink() {
  const pathname = usePathname();
  if (HAS_OWN_BACK.test(pathname)) return null;
  return <div className="mb-3"><BackLink href="/" label="Home" /></div>;
}
