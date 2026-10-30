import "@/components/approvals/approvals.css";
import { Suspense } from "react";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { HubShell } from "@/components/HubShell";
import { ApprovalsSidebar, type SideLink } from "@/components/approvals/ApprovalsSidebar";
import { ModuleHeader } from "@/components/approvals/ModuleHeader";
import { MobileMenu } from "@/components/MobileMenu";
import { MY_APPROVALS_ROLES, REVIEW_KEYS, REVIEW_LABEL, REVIEW_TABS, REVIEW_TAB_LABEL, type ReviewKey } from "@/lib/approvals/approvals.manifest";
import { requirePage } from "@/lib/approvals/guard";
import { hasAnyRole, hasRole, type ApprovalsUser } from "@/lib/approvals/host-adapter";
import { unreadCount } from "@/lib/approvals/notify";
import { countRequests, reviewItemsFor, type ListFilter } from "@/lib/approvals/request-queries";
import { reviewScreen, screenFor, type ListScreen } from "@/lib/approvals/screens";
import { requireUser } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approval System · MCCIA App Hub" };

/**
 * What the sidebar holds for this person. Everyone: Approval Forms (the forms), My Pending Approvals (their own requests still pending or needing correction, amber badge)
 * and Approved Forms. Under Approval Forms, whoever decides
 * requests gets the places they decide in, each with its Pending, Approved and Rejected lists: the Director General and the Support Admin
 * both HR and Expenditure, an approver the place their role gives them (HR Admin: HR, Expense Admin: Expenditure). Below Approved Forms,
 * the same people get My Pending Approvals (a red badge while anything waits) and My Approvals.
 */
async function sidebarFor(user: ApprovalsUser): Promise<SideLink[]> {
  const dg = hasRole(user, "dg");
  const decides = hasAnyRole(user, ["approver", "dg"]);
  const approvedHref = decides ? "/approvals/decided/approved" : "/approvals/my/approved";
  // How many requests each line opens: counted with the same filter as the list itself, so the number always matches the page. Every
  // line's count comes from one query; a line with no list counts 0. Both places (HR and Expenditure) are counted while the places this
  // person has are worked out, so the two do not wait for each other; the counts of a place they do not have are simply not shown.
  const filterOf = (s: ListScreen): ListFilter =>
    ({ types: s.types, statuses: s.statuses, mine: s.mine, waitingForMe: s.waitingForMe, approvedByMe: s.approvedByMe, rejectedByMe: s.rejectedByMe });
  const screens = [...REVIEW_KEYS.flatMap((k) => REVIEW_TABS.map((t) => reviewScreen(k, t, decides))), screenFor(approvedHref.replace("/approvals/", "").split("/"))];
  // My Pending Approvals for everyone (their own requests still pending or needing correction), and for people who decide the second
  // My Pending Approvals (waiting for their decision) and My Approvals: counted in
  // the same query, with the filters their pages list by.
  const mineToo = hasAnyRole(user, MY_APPROVALS_ROLES);
  const mineFilters: ListFilter[] = [{ mine: true, statuses: ["pending", "returned"] },...(mineToo ? [{ statuses: ["pending"], waitingForMe: true }, { decidedByMe: true }] satisfies ListFilter[] : [])];
  const [items, got] = await Promise.all([reviewItemsFor(user), countRequests(user, [...screens.flatMap((s) => (s ? [filterOf(s)] : [])), ...mineFilters])]);
  const keys: ReviewKey[] = dg || hasRole(user, "approvals_admin") ? [...REVIEW_KEYS] : REVIEW_KEYS.filter((k) => items.some((i) => i.key === k));
  let next = 0;
  const counts = screens.map((s) => (s ? got[next++] : 0));
  const [ownOpen = 0, myPending = 0, myDecided = 0] = got.slice(next);
  const placeCounts = keys.map((k) => { const i = REVIEW_KEYS.indexOf(k); return counts.slice(i * REVIEW_TABS.length, (i + 1) * REVIEW_TABS.length); });
  const approvedCount = counts[counts.length - 1];
  const places: SideLink[] = keys.map((k, i) => {
    const counts = placeCounts[i];
    return {
      label: REVIEW_LABEL[k], href: `/approvals/review/${k}/pending`, waiting: counts[0],
      children: REVIEW_TABS.map((t, j) => ({ label: `${REVIEW_TAB_LABEL[t]} ${REVIEW_LABEL[k]} Approvals`, href: `/approvals/review/${k}/${t}`, ...(t === "pending" && counts[j] > 0 ? { waiting: counts[j] } : { count: counts[j] }) })),
    };
  });
  return [
    { label: "Approval Forms", href: "/approvals", children: places },
    { label: "My Pending Approvals", href: "/approvals/my-requests", ...(ownOpen > 0 ? { open: ownOpen } : { count: 0 }) },
    { label: "Approved Forms", href: approvedHref, count: approvedCount },
    ...(mineToo
      ? [
          { label: "My Pending Approvals", href: "/approvals/my-pending-approvals", ...(myPending > 0 ? { waiting: myPending } : { count: 0 }) },
          { label: "My Approvals", href: "/approvals/my-approvals", count: myDecided },
        ]
      : []),
  ];
}

/**
 * Approval System opens inside the hub's own frame (its top bar), with its own sidebar beside the pages. It sits beside the hub's layout
 * group rather than inside it, on purpose: the hub's loading screen would start streaming the page early, and then a missing page or a
 * redirect could no longer answer with a real 404 or redirect.
 */
export default async function ApprovalsLayout({ children }: { children: React.ReactNode }) {
  const [hubUser, user] = await Promise.all([requireUser(), requirePage()]);
  const [unread, links] = await Promise.all([unreadCount(user.id), sidebarFor(user)]);
  return (
    <HubShell user={{ name: hubUser.name, role: hubUser.role }}>
      <ConfirmProvider>
        <div className="apr-root flex flex-col gap-6 lg:flex-row lg:items-start">
          <aside className="w-full shrink-0 lg:sticky lg:top-20 lg:w-72">
            <MobileMenu label="Approval System menu"><ApprovalsSidebar links={links} /></MobileMenu>
          </aside>
          <div className="min-w-0 flex-1">
            <Suspense fallback={null}>
              <ModuleHeader roles={user.roles} unread={unread} />
            </Suspense>
            <div className="page-slot mt-6">{children}</div>
          </div>
        </div>
      </ConfirmProvider>
    </HubShell>
  );
}
