"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { NotificationBell } from "@/components/approvals/NotificationBell";
import { REVIEW_LABEL, approvalsApps, parseReviewPath, resolveApp, type ApprovalsRole } from "@/lib/approvals/approvals.manifest";

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
  const review = parseReviewPath(pathname.split("/").filter(Boolean).slice(1));
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h1 className="text-2xl text-ink sm:text-3xl">{review ? REVIEW_LABEL[review.key] : app.title}</h1>
      <NotificationBell initialUnread={unread} />
    </div>
  );
}
