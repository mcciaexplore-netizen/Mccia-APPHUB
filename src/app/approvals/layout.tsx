import "@/components/approvals/approvals.css";
import { Suspense } from "react";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { HubShell } from "@/components/HubShell";
import { ApprovalsSidebar, type SideLink } from "@/components/approvals/ApprovalsSidebar";
import { ModuleHeader } from "@/components/approvals/ModuleHeader";
import { REVIEW_KEYS, REVIEW_LABEL, REVIEW_TABS, REVIEW_TAB_LABEL, type ReviewKey } from "@/lib/approvals/approvals.manifest";
import { requirePage } from "@/lib/approvals/guard";
import { hasAnyRole, hasRole, type ApprovalsUser } from "@/lib/approvals/host-adapter";
import { unreadCount } from "@/lib/approvals/notify";
import { reviewItemsFor } from "@/lib/approvals/request-queries";
import { requireUser } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approval System · MCCIA App Hub" };

/**
 * What the sidebar holds for this person. Everyone: Approval Forms (the forms) and Approved Forms. Under Approval Forms, whoever decides
 * requests gets the places they decide in, each with its Pending, Approved and Rejected lists: the Director General and the Support Admin
 * both HR and Expenditure, an approver the place the Approver Rules give them.
 */
async function sidebarFor(user: ApprovalsUser): Promise<SideLink[]> {
  const items = await reviewItemsFor(user);
  const dg = hasRole(user, "dg");
  const keys: ReviewKey[] = dg || hasRole(user, "approvals_admin") ? [...REVIEW_KEYS] : REVIEW_KEYS.filter((k) => items.some((i) => i.key === k));
  const recommended = items.find((i) => i.key === "recommendation");
  const waiting = (k: ReviewKey) => (dg ? recommended?.counts?.[k] : items.find((i) => i.key === k)?.waiting) ?? 0;
  const places: SideLink[] = keys.map((k) => ({
    label: REVIEW_LABEL[k], href: `/approvals/review/${k}/pending`, waiting: waiting(k),
    children: REVIEW_TABS.map((t) => ({ label: `${REVIEW_TAB_LABEL[t]} ${REVIEW_LABEL[k]} Approvals`, href: `/approvals/review/${k}/${t}`, waiting: t === "pending" ? waiting(k) : 0 })),
  }));
  return [
    { label: "Approval Forms", href: "/approvals", children: places },
    { label: "Approved Forms", href: hasAnyRole(user, ["approver", "dg"]) ? "/approvals/decided/approved" : "/approvals/my/approved" },
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
            <ApprovalsSidebar links={links} />
          </aside>
          <div className="min-w-0 flex-1">
            <Suspense fallback={null}>
              <ModuleHeader roles={user.roles} unread={unread} />
            </Suspense>
            <div className="mt-6">{children}</div>
          </div>
        </div>
      </ConfirmProvider>
    </HubShell>
  );
}
