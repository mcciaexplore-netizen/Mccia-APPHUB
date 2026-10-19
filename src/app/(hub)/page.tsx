export const dynamic = "force-dynamic";

import { requireUser } from "@/lib/permissions";
import { getAccessibleApps } from "@/lib/access";
import { approvalsEnabled } from "@/lib/approvals/flags";
import { canAdminister, isSuper } from "@/lib/rbac";
import { HomeClient, type HubCard } from "./HomeClient";

/**
 * The hub's one page of cards: the Approval System and Administrator (for those who may open them), a team manager's own pages, and every
 * application this person may open, all together with no categories.
 */
export default async function HomePage() {
  const user = await requireUser();
  const apps = await getAccessibleApps(user);
  const cards: HubCard[] = [
    ...(approvalsEnabled() ? [{ id: "hub-approvals", name: "Approval System", description: "Raise HR and expense requests, and review the ones waiting for you.", icon: "ClipboardList", href: "/approvals" }] : []),
    ...(canAdminister(user) ? [{ id: "hub-administrator", name: "Administrator", description: "Users, access, the approval forms, notifications and the activity log.", icon: "Shield", href: "/administrator" }] : []),
    ...(user.role === "dept_lead"
      ? [
          { id: "hub-team", name: "My team", description: "The people in your team and what they can open.", icon: "Users", href: "/team" },
          { id: "hub-activity", name: "Activity", description: "Which applications your team opened.", icon: "BarChart3", href: "/activity" },
        ]
      : []),
  ];
  // Only ids, names, descriptions and icons are sent. App URLs never leave the server except through /go.
  return <div className="page-enter"><HomeClient cards={cards} apps={apps.map(({ departmentId: _d, ...a }) => a)} isAdmin={isSuper(user)} /></div>;
}
