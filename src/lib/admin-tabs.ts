import { hasArea, isSuper, type Actor } from "@/lib/rbac";

/**
 * The sections of Administrator, and which area of access opens each. The sidebar and the Administrator tab bar both ask here, so a
 * person is only ever shown what they may open. The Dashboard (counts only) is for everyone who may open Administrator at all.
 */
export type AdminTab = { href: string; label: string; exact?: boolean };

export function adminTabsFor(a: Pick<Actor, "role" | "adminAreas">): AdminTab[] {
  const tabs: AdminTab[] = [{ href: "/administrator", label: "Dashboard", exact: true }];
  // Departments are the organisation's (where people sit). Application categories arrange the applications in the hub.
  if (hasArea(a, "org")) tabs.push({ href: "/administrator/org-departments", label: "Departments" });
  // Users & Access opens on the first page of it the person may use.
  const users = hasArea(a, "people") ? "/administrator/users"
    : hasArea(a, "import") ? "/administrator/users/import"
    : hasArea(a, "org") ? "/administrator/users/org"
    : hasArea(a, "audit") ? "/administrator/users/audit" : null;
  if (users) tabs.push({ href: users, label: "Users & Access" });
  if (hasArea(a, "apps")) tabs.push({ href: "/administrator/inventory", label: "Applications" }, { href: "/administrator/departments", label: "Application categories" });
  if (isSuper(a)) tabs.push({ href: "/administrator/approvals", label: "Approvals" });
  tabs.push({ href: "/administrator/notifications", label: "Notifications Panel" });
  if (hasArea(a, "activity")) tabs.push({ href: "/administrator/activity", label: "Activity log" });
  return tabs;
}

/** The pages inside Users & Access that this person may open (Bulk add is reached from the People page, as before). */
export function peopleTabsFor(a: Pick<Actor, "role" | "adminAreas">) {
  const base = "/administrator/users";
  const items: { href: string; label: string; match: (p: string) => boolean }[] = [];
  if (hasArea(a, "people")) items.push({ href: base, label: "People", match: (p) => !p.startsWith(`${base}/org`) && !p.startsWith(`${base}/audit`) });
  if (hasArea(a, "org")) items.push({ href: `${base}/org`, label: "Branches & teams", match: (p) => p.startsWith(`${base}/org`) });
  if (hasArea(a, "audit")) items.push({ href: `${base}/audit`, label: "Audit log", match: (p) => p.startsWith(`${base}/audit`) });
  if (hasArea(a, "people")) items.push({ href: "/administrator/access", label: "By application & templates", match: () => false });
  return items;
}
