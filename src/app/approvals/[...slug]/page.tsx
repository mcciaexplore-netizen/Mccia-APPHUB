import { notFound } from "next/navigation";
import { ListScreenView } from "@/components/approvals/ListScreenView";
import { Placeholder } from "@/components/approvals/Placeholder";
import { ReviewTabs } from "@/components/approvals/ReviewTabs";
import { FULL_ACCESS_ROLES, allNavItems, canSee, parseReviewPath } from "@/lib/approvals/approvals.manifest";
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
 */
export default async function Page({ params, searchParams }: { params: Promise<{ slug: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const path = `/approvals/${slug.join("/")}`;
  const review = parseReviewPath(slug);
  const item = allNavItems().find((i) => i.href === path);
  if (!item && !review && !resolveScreen(slug, false)) notFound();
  const user = await requirePage(...FULL_ACCESS_ROLES);
  if (item && !canSee(item, user.roles)) notFound();
  if (review) {
    const mine = (await reviewItemsFor(user)).find((i) => i.key === review.key);
    if (!mine) notFound();
    const decides = hasAnyRole(user, ["approver", "dg"]);
    const screen = resolveScreen(slug, decides)!;
    return (
      <>
        <ReviewTabs place={review.key} active={review.tab} waiting={decides ? mine.waiting : 0} />
        <ListScreenView slug={slug.join("/")} screen={screen} params={parseListParams(await searchParams)} user={user} />
      </>
    );
  }
  const screen = resolveScreen(slug, false);
  if (screen) return <ListScreenView slug={slug.join("/")} screen={screen} params={parseListParams(await searchParams)} user={user} />;
  return <Placeholder title={item!.label} />;
}
