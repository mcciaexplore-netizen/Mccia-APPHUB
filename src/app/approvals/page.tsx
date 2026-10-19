import { Suspense } from "react";
import { ApproverDashboard, DgDashboard, StaffDashboard, SupportAdminDashboard, ViewerDashboard } from "@/components/approvals/Dashboards";
import { DashboardSkeleton } from "@/components/approvals/Skeletons";
import { requirePage } from "@/lib/approvals/guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approval System · MCCIA App Hub" };

/** The heading shows at once; the dashboard's data streams in under it, with a placeholder until then. */
function Shell({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <div className="page-enter">
      <div className="mb-8">
        <h1 className="text-2xl text-ink sm:text-3xl">{title}</h1>
        <p className="mt-1 text-sm text-subtle">{intro}</p>
      </div>
      <Suspense fallback={<DashboardSkeleton />}>{children}</Suspense>
    </div>
  );
}

/**
 * The Approval System's own page, reached from the hub's sidebar. What it shows follows the person's roles, first match wins: the Support
 * Admin's back office, the Director General's final decisions, an approver's review queue, a viewer's overview, and for everyone else the
 * forms to raise a request with their own recent submissions.
 */
export default async function Page() {
  const user = await requirePage();
  const roles = user.roles;
  if (roles.includes("approvals_admin")) {
    return <Shell title="Approval System" intro="Who approves what, the set-up screens, and what is waiting now."><SupportAdminDashboard user={user} /></Shell>;
  }
  if (roles.includes("dg")) {
    return <Shell title="Approval System" intro="What has been recommended to you for the final decision."><DgDashboard user={user} /></Shell>;
  }
  if (roles.includes("approver")) {
    return <Shell title="Approval System" intro="Requests waiting for your review."><ApproverDashboard user={user} /></Shell>;
  }
  if (roles.includes("viewer")) {
    return <Shell title="Approval System" intro="Every request, at a glance."><ViewerDashboard /></Shell>;
  }
  return <Shell title="Submit a Request" intro="Choose what you need to raise"><StaffDashboard user={user} /></Shell>;
}
