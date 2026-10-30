export const dynamic = "force-dynamic";

import { requireUser } from "@/lib/permissions";
import { cardFacts, getAccessibleApps } from "@/lib/access";
import { waitingCount } from "@/lib/approvals/request-queries";
import { approvalsEnabled } from "@/lib/approvals/flags";
import { canAdminister, isSuper } from "@/lib/rbac";
import { HomeClient, type HomeApp, type HubCard } from "./HomeClient";

/** "today", "yesterday", "3 days ago", "2 weeks ago", or the date for anything older than a month. */
function ago(d: Date, now = Date.now()): string {
  const days = Math.floor((now - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} ${days < 14 ? "week" : "weeks"} ago`;
  return `on ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}`;
}

/**
 * The hub's one page of cards: the Approval System and Administrator (for those who may open them), a team manager's own pages, and every
 * application this person may open, all together with no categories.
 */
export default async function HomePage() {
  const user = await requireUser();
  // All at once: none of these needs another's answer, so the page waits for the database once, not three times in a row.
  const [apps, facts, waiting] = await Promise.all([
    getAccessibleApps(user),
    cardFacts(user.id, canAdminister(user)),
    // What waits for this person in the Approval System, for the red count on its card.
    approvalsEnabled() ? waitingCount(user.id) : Promise.resolve(0),
  ]);
  const cards: HubCard[] = [
    ...(approvalsEnabled() ? [{ id: "hub-approvals", name: "Approval System", description: "Raise HR and expense requests, and review the ones waiting for you.", icon: "ClipboardList", href: "/approvals", waiting }] : []),
    ...(canAdminister(user) ? [{ id: "hub-administrator", name: "Administrator", description: "Users, access, the approval forms, notifications and the activity log.", icon: "Shield", href: "/administrator" }] : []),
    ...(user.role === "dept_lead"
      ? [
          { id: "hub-team", name: "My team", description: "The people in your team and what they can open.", icon: "Users", href: "/team" },
          { id: "hub-activity", name: "Activity", description: "Which applications your team opened.", icon: "BarChart3", href: "/activity" },
        ]
      : []),
  ];
  // Only ids, names, descriptions and icons are sent. App URLs never leave the server except through /go.
  return <div className="page-enter"><HomeClient name={user.name} cards={cards} apps={apps.map(({ departmentId: _d, ...a }): HomeApp => ({ ...a, category: facts.category.get(a.id), lastOpened: facts.lastOpened.has(a.id) ? ago(facts.lastOpened.get(a.id)!) : undefined, people: canAdminister(user) ? facts.people.get(a.id) ?? 0 : undefined }))} isAdmin={isSuper(user)} /></div>;
}
