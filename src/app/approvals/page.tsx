import { Suspense } from "react";
import Link from "next/link";
import { ApproverDashboard, DgDashboard, StaffDashboard, SupportAdminDashboard, ViewerDashboard } from "@/components/approvals/Dashboards";
import { DashboardSkeleton } from "@/components/approvals/Skeletons";
import { REVIEW_LABEL, SETUP_GROUP_LABEL, approvalsApps, isGroup, reviewHref, type ReviewItem } from "@/lib/approvals/approvals.manifest";
import { requirePage } from "@/lib/approvals/guard";
import { hasRole } from "@/lib/approvals/host-adapter";
import { reviewItemsFor } from "@/lib/approvals/request-queries";

/** The Support Admin's set-up screens (Who Approves What, Expense Types, ...), read from the Approval System menu data. */
const SETUP_LINKS = approvalsApps.flatMap((a) => a.nav).flatMap((e) => (isGroup(e) && e.label === SETUP_GROUP_LABEL ? e.items : []));
const PLACE_TEXT: Record<ReviewItem["key"], string> = {
  hr: "HR requests: pending, approved and rejected.",
  expenditure: "Expenses of every amount: pending, approved and rejected.",
  recommendation: "What was recommended to you, HR and Expenditure.",
};

const tile = "card-lift glass !rounded-md flex flex-col gap-1 p-5";

/** Where this person works in the Approval System, as cards: their review places, and for the Support Admin the set-up screens. */
function Places({ review, setup }: { review: ReviewItem[]; setup: boolean }) {
  if (review.length === 0 && !setup) return null;
  return (
    <div className="mb-10 space-y-8">
      {review.length > 0 && (
        <section aria-label="Your places">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {review.map((r) => (
              <Link key={r.key} href={reviewHref(r.key)} className={tile}>
                <span className="flex items-center justify-between gap-2 font-bold text-ink">{REVIEW_LABEL[r.key]}
                  {r.waiting > 0 && <span className="rounded-pill bg-brand-red px-2 text-xs font-bold leading-5 text-white">{r.waiting} waiting</span>}
                </span>
                <span className="text-sm text-subtle">{PLACE_TEXT[r.key]}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
      {setup && (
        <section aria-label={SETUP_GROUP_LABEL}>
          <h2 className="mb-4 text-lg text-ink">{SETUP_GROUP_LABEL}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SETUP_LINKS.map((l) => <Link key={l.href} href={l.href!} className={tile}><span className="font-bold text-ink">{l.label}</span></Link>)}
          </div>
        </section>
      )}
    </div>
  );
}

export const dynamic = "force-dynamic";
export const metadata = { title: "Approval System · MCCIA App Hub" };

/** The heading shows at once; the dashboard's data streams in under it, with a placeholder until then. */
function Shell({ title, intro, top, children }: { title: string; intro: string; top: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="page-enter">
      <div className="mb-8">
        <h1 className="text-2xl text-ink sm:text-3xl">{title}</h1>
        <p className="mt-1 text-sm text-subtle">{intro}</p>
      </div>
      {top}
      <Suspense fallback={<DashboardSkeleton />}>{children}</Suspense>
    </div>
  );
}

/**
 * The Approval System's own page, opened from its card on the hub's home page. What it shows follows the person's roles, first match wins: the Support
 * Admin's back office, the Director General's final decisions, an approver's review queue, a viewer's overview, and for everyone else the
 * forms to raise a request with their own recent submissions.
 */
export default async function Page() {
  const user = await requirePage();
  const roles = user.roles;
  const top = <Places review={await reviewItemsFor(user)} setup={hasRole(user, "approvals_admin")} />;
  if (roles.includes("approvals_admin")) {
    return <Shell top={top} title="Approval System" intro="Who approves what, the set-up screens, and what is waiting now."><SupportAdminDashboard user={user} /></Shell>;
  }
  if (roles.includes("dg")) {
    return <Shell top={top} title="Approval System" intro="What has been recommended to you for the final decision."><DgDashboard user={user} /></Shell>;
  }
  if (roles.includes("approver")) {
    return <Shell top={top} title="Approval System" intro="Requests waiting for your review."><ApproverDashboard user={user} /></Shell>;
  }
  if (roles.includes("viewer")) {
    return <Shell top={top} title="Approval System" intro="Every request, at a glance."><ViewerDashboard /></Shell>;
  }
  return <Shell top={top} title="Submit a Request" intro="Choose what you need to raise"><StaffDashboard user={user} /></Shell>;
}
