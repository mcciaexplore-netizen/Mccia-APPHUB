"use client";

import { usePathname } from "next/navigation";
import { BackLink } from "@/components/BackLink";
import { NotificationBell } from "@/components/approvals/NotificationBell";
import { pageHeading, type ApprovalsRole } from "@/lib/approvals/approvals.manifest";

/**
 * The top of every Approval System page: its main heading and the bell. The heading follows the page (see pageHeading): an HR, expenditure
 * or budget page names its kind; a person's own lists their name, with "Approval System" under it; mixed and set-up pages "Approval System".
 * A request's own page heads itself from the request's kind. The page itself is drawn by the layout, outside this component, so a page that
 * is not found or redirects still answers with a real 404 or redirect.
 */
export function ModuleHeader({ unread }: { roles?: ApprovalsRole[]; unread: number }) {
  const pathname = usePathname();
  if (pathname === "/approvals") return null; // the Approval System's own page (the form cards) has its own heading
  const heading = pageHeading(pathname);
  const revise = /^\/approvals\/requests\/([^/]+)\/revise$/.exec(pathname);
  // Where "← Back" goes: a request back to the list it was opened from; its correction form to the request; the settings screens to
  // Administrator (where they are opened from); every other page to Approval Forms.
  const edit = /^\/approvals\/requests\/([^/]+)\/edit$/.exec(pathname);
  const back = edit ? { href: `/approvals/requests/${edit[1]}`, label: "Back to the request" }
    : revise ? { href: `/approvals/requests/${revise[1]}?app=hr`, label: "Back to the budget" }
    : pathname.startsWith("/approvals/requests/") ? { href: "/approvals", label: "Back", history: true }
    : pathname.startsWith("/approvals/admin/") ? { href: "/administrator", label: "Back to Administrator" }
    : { href: "/approvals", label: "Back to Approval Forms" };
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <BackLink {...back} />
        {heading && <h1 className="mt-1 text-2xl text-ink sm:text-3xl" data-testid="module-heading">{heading.title}</h1>}
        {heading?.subtitle && <p className="mt-0.5 text-sm font-semibold uppercase tracking-wide text-muted" data-testid="module-subheading">{heading.subtitle}</p>}
      </div>
      <NotificationBell initialUnread={unread} />
    </div>
  );
}
