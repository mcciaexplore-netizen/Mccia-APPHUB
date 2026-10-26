import { hasArea, isSuper, type Actor } from "@/lib/rbac";

/**
 * The sections of Administrator, and which area of access opens each. The Administrator sidebar asks here, so a person is only ever shown
 * what they may open. "main": Dashboard, Users, Applications, Activity Log. "settings" (Settings & Administration): Approval Forms, HR,
 * Expenditure and the Notification Panel.
 */
export type AdminTab = { href: string; label: string; group: "main" | "settings"; exact?: boolean; /** Lines under this one in the sidebar. */ children?: { href: string; label: string }[] };

export function adminTabsFor(a: Pick<Actor, "role" | "adminAreas">): AdminTab[] {
  const tabs: AdminTab[] = [{ href: "/administrator", label: "Dashboard", group: "main", exact: true }];
  // Users: the list, adding, editing and access, plus bulk add and branches & teams. It opens on the first page of it the person may use.
  const users = hasArea(a, "people") ? "/administrator/users" : hasArea(a, "import") ? "/administrator/users/import" : hasArea(a, "org") ? "/administrator/users/org" : null;
  if (users) tabs.push({ href: users, label: "Users", group: "main" });
  if (hasArea(a, "apps")) tabs.push({ href: "/administrator/inventory", label: "Applications", group: "main" });
  // One log: the app opens (Activity log area) and the changes, approvals and sign-ins (Audit log area), each on its own tab.
  if (hasArea(a, "activity")) tabs.push({ href: "/administrator/activity", label: "Activity Log", group: "main" });
  else if (hasArea(a, "audit")) tabs.push({ href: "/administrator/activity?tab=changes", label: "Activity Log", group: "main" });
  if (isSuper(a)) {
    tabs.push(
      { href: "/administrator/approval-forms", label: "Approval Forms", group: "settings", exact: true },
      { href: "/administrator/approval-forms/hr", label: "HR", group: "settings" },
      { href: "/administrator/approval-forms/expenditure", label: "Expenditure", group: "settings" },
    );
  }
  tabs.push({ href: "/administrator/notifications", label: "Notification Panel", group: "settings" });
  return tabs;
}
