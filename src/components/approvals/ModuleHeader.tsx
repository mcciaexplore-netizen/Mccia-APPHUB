"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { BackLink } from "@/components/BackLink";
import { NotificationBell } from "@/components/approvals/NotificationBell";
import { REVIEW_LABEL, approvalsApps, parseRecommendationPath, parseReviewPath, resolveApp, type ApprovalsRole } from "@/lib/approvals/approvals.manifest";

/**
 * The top of every Approval System page: the application's name and the bell. There is no menu of sections and pages around it; the forms
 * are reached from the cards on the Approval System page. Which application it names follows the page. The page itself is drawn by the
 * layout, outside this component, so a page that is not found or redirects still answers with a real 404 or redirect.
 */
export function ModuleHeader({ roles, unread }: { roles: ApprovalsRole[]; unread: number }) {
  const pathname = usePathname();
  const appParam = useSearchParams().get("app");
  const app = approvalsApps.find((a) => a.key === resolveApp(pathname, appParam, roles))!;
  if (pathname === "/approvals") return null; // the Approval System's own page (the form cards) has its own heading
  const parts = pathname.split("/").filter(Boolean).slice(1);
  const review = parseReviewPath(parts);
  const title = review ? REVIEW_LABEL[review.key] : parseRecommendationPath(parts) ? REVIEW_LABEL.recommendation : app.title;
  // Where "← Back" goes: a request back to the list it was opened from; its correction form to the request; the settings screens to
  // Administrator (where they are opened from); every other page to Approval Forms.
  const edit = /^\/approvals\/requests\/([^/]+)\/edit$/.exec(pathname);
  const back = edit ? { href: `/approvals/requests/${edit[1]}`, label: "Back to the request" }
    : pathname.startsWith("/approvals/requests/") ? { href: "/approvals", label: "Back", history: true }
    : pathname.startsWith("/approvals/admin/") ? { href: "/administrator", label: "Back to Administrator" }
    : { href: "/approvals", label: "Back to Approval Forms" };
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <BackLink {...back} />
        <h1 className="mt-1 text-2xl text-ink sm:text-3xl">{title}</h1>
      </div>
      <NotificationBell initialUnread={unread} />
    </div>
  );
}
