import { hasArea, isSuper, type Actor } from "@/lib/rbac";

/**
 * The sections of Administrator, and which area of access opens each. The sidebar asks here, so a person is only ever shown what they may
 * open. The Dashboard (counts only) is for everyone who may open Administrator at all.
 */
export type AdminTab = { href: string; label: string; exact?: boolean };

export function adminTabsFor(a: Pick<Actor, "role" | "adminAreas">): AdminTab[] {
  const tabs: AdminTab[] = [{ href: "/administrator", label: "Dashboard", exact: true }];
  // Users opens on the first page of it the person may use.
  const users = hasArea(a, "people") ? "/administrator/users"
    : hasArea(a, "import") ? "/administrator/users/import"
    : hasArea(a, "org") ? "/administrator/users/org"
    : hasArea(a, "audit") ? "/administrator/users/audit" : null;
  if (users) tabs.push({ href: users, label: "Users" });
  if (isSuper(a)) tabs.push({ href: "/administrator/approval-forms", label: "Approval Forms" });
  tabs.push({ href: "/administrator/notifications", label: "Notification Panel" });
  if (hasArea(a, "activity")) tabs.push({ href: "/administrator/activity", label: "Activity Log" });
  return tabs;
}
