import { hasArea, isSuper, type Actor } from "@/lib/rbac";

/**
 * The sections of Administrator, and which area of access opens each. The Administrator sidebar asks here, so a person is only ever shown
 * what they may open. "main" is the sidebar's five sections; "settings" sits under its own heading below them.
 */
export type AdminTab = { href: string; label: string; group: "main" | "settings"; exact?: boolean };

export function adminTabsFor(a: Pick<Actor, "role" | "adminAreas">): AdminTab[] {
  const tabs: AdminTab[] = [{ href: "/administrator", label: "Dashboard", group: "main", exact: true }];
  // Users is the list and each person's details, to look at; User Administration is where people are added, changed and given access.
  if (hasArea(a, "people")) tabs.push({ href: "/administrator/users", label: "Users", group: "main" });
  if (hasArea(a, "apps")) tabs.push({ href: "/administrator/inventory", label: "Applications", group: "main" });
  const manage = hasArea(a, "people") ? "/administrator/manage" : hasArea(a, "import") ? "/administrator/users/import" : hasArea(a, "org") ? "/administrator/users/org" : null;
  if (manage) tabs.push({ href: manage, label: "User Administration", group: "main" });
  // One log: the app opens (Activity log area) and the changes, approvals and sign-ins (Audit log area), each on its own tab.
  if (hasArea(a, "activity")) tabs.push({ href: "/administrator/activity", label: "Activity Log", group: "main" });
  else if (hasArea(a, "audit")) tabs.push({ href: "/administrator/activity?tab=changes", label: "Activity Log", group: "main" });
  if (isSuper(a)) tabs.push({ href: "/administrator/approval-forms", label: "Approval Forms", group: "settings" });
  tabs.push({ href: "/administrator/notifications", label: "Notification Panel", group: "settings" });
  return tabs;
}
