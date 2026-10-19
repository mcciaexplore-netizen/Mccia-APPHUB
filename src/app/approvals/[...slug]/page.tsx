import { Suspense } from "react";
import { notFound } from "next/navigation";
import { ListScreenView } from "@/components/approvals/ListScreenView";
import { RecommendationTabs } from "@/components/approvals/RecommendationTabs";
import { ReviewTabs } from "@/components/approvals/ReviewTabs";
import { TableSkeleton } from "@/components/approvals/Skeletons";
import { FULL_ACCESS_ROLES, allNavItems, canSee, parseRecommendationPath, parseReviewPath } from "@/lib/approvals/approvals.manifest";
import { requirePage } from "@/lib/approvals/guard";
import { hasAnyRole } from "@/lib/approvals/host-adapter";
import { parseListParams } from "@/lib/approvals/list-params";
import { reviewItemsFor } from "@/lib/approvals/request-queries";
import { resolveScreen } from "@/lib/approvals/screens";

/**
 * The list screens (Approved HR requests, Pending Expenditure Requests, the DG's inbox, ...) all live here: each is the same table with
 * a different starting filter (see screens.ts). A path that is not in the menu, or that this person's roles do not allow, is a plain
 * 404, and so is every one of these pages for someone without full access (they only get the forms). A real page placed at the same
 * path takes over from this one.
 *
 * The Pending, Approved and Rejected lists of HR and of Expenditure (/approvals/review/hr/pending, ...) are the approver's own place to
 * work, opened from the sidebar under Approval System. Only someone who approves that kind of request, or oversees them all, may open them.
 * The Director General has one place instead, Recommended (/approvals/review/recommendation/hr and .../expenditure): what was recommended to them.
 */
/** The table streams in under whatever is above it; every check that can make the page a 404 has already run by then. */
const Streamed = ({ children }: { children: React.ReactNode }) => <Suspense fallback={<TableSkeleton />}>{children}</Suspense>;

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const path = `/approvals/${slug.join("/")}`;
  const review = parseReviewPath(slug);
  const recommended = parseRecommendationPath(slug);
  const item = allNavItems().find((i) => i.href === path);
  if (!item && !review && !recommended && !resolveScreen(slug, false)) notFound();
  const user = await requirePage(...FULL_ACCESS_ROLES);
  if (item && !canSee(item, user.roles)) notFound();
  if (recommended) {
    // The Director General's place: what was recommended to them, a tab each for HR and Expenditure.
    const mine = (await reviewItemsFor(user)).find((i) => i.key === "recommendation");
    if (!mine?.counts) notFound();
    return (
      <div className="page-enter">
        <RecommendationTabs active={recommended} counts={mine.counts} />
        <Streamed><ListScreenView slug={slug.join("/")} screen={resolveScreen(slug, true)!} params={parseListParams(await searchParams)} user={user} /></Streamed>
      </div>
    );
  }
  if (review) {
    const mine = (await reviewItemsFor(user)).find((i) => i.key === review.key);
    if (!mine) notFound();
    const decides = hasAnyRole(user, ["approver", "dg"]);
    const screen = resolveScreen(slug, decides)!;
    return (
      <div className="page-enter">
        <ReviewTabs place={review.key} active={review.tab} waiting={decides ? mine.waiting : 0} />
        <Streamed><ListScreenView slug={slug.join("/")} screen={screen} params={parseListParams(await searchParams)} user={user} /></Streamed>
      </div>
    );
  }
  const screen = resolveScreen(slug, false);
  if (screen) return <div className="page-enter"><Streamed><ListScreenView slug={slug.join("/")} screen={screen} params={parseListParams(await searchParams)} user={user} /></Streamed></div>;
  notFound();
}
