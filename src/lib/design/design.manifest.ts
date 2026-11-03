/**
 * What the DesignDesk module is, for the host: its sections, who may open each, and their menus. Pure data and functions (no server code),
 * so the client sidebars and the unit tests can import it too.
 *
 * The module shows in the hub as two applications, each an ordinary row in Administrator → Applications with its own access grants:
 *   Design Team         URL /design         office staff who ASK the creative team for designs: the request form, their own
 *                                           requests (track, approve proofs, download finals), the board of accepted requests, campaigns
 *   Design Team Admin   URL /design/admin   the CREATIVE TEAM who fulfil requests: every ticket, the board, proofs, files, library,
 *                                           calendar; its App Admins also accept or decline requests, assign, set priority, see
 *                                           workload and reports and change settings
 * The review and tracking links (/review/<token>, /track/<token>) work without signing in.
 *
 * Roles:
 *   design_requester    anyone given the Design Team application
 *   design_member       anyone given the Design Team Admin application
 *   design_lead         an App Admin of the Design Team Admin application (who also holds it)
 *   design_super_admin  the Support Admin (head_admin) only: also Integrations (email test, Slack) and "Delete all past data"
 * The Support Admin holds all four.
 *
 * Data: a requester sees only the requests they made (and the list of accepted requests: titles and progress). The creative team sees
 * every request.
 */

export type DesignRole = "design_requester" | "design_member" | "design_lead" | "design_super_admin";
export type DesignSection = "requester" | "admin";

export const DESIGN_TEAM_URL_PATTERN = "^/design/?$";
export const DESIGN_ADMIN_URL_PATTERN = "^/design/admin/?$";

/** The roles that open each section (any one is enough). The creative team may use the request pages too. */
export const SECTION_ROLES: Record<DesignSection, readonly DesignRole[]> = {
  requester: ["design_requester", "design_member", "design_lead", "design_super_admin"],
  admin: ["design_member", "design_lead", "design_super_admin"],
};

/** A person's roles from what the hub says about them (see the header). */
export function designRolesFor(input: { hubRole: string; teamAccess: boolean; adminAccess: boolean; adminAppAdmin: boolean }): DesignRole[] {
  const head = input.hubRole === "head_admin";
  const roles: DesignRole[] = [];
  if (head || input.teamAccess) roles.push("design_requester");
  if (head || input.adminAccess) roles.push("design_member");
  if (head || (input.adminAccess && input.adminAppAdmin)) roles.push("design_lead");
  if (head) roles.push("design_super_admin");
  return roles;
}

export const isLead = (roles: readonly DesignRole[]) => roles.includes("design_lead") || roles.includes("design_super_admin");
export const isMember = (roles: readonly DesignRole[]) => roles.includes("design_member") || isLead(roles);
export const isRequester = (roles: readonly DesignRole[]) => SECTION_ROLES.requester.some((r) => roles.includes(r));

export type DesignNavItem = { label: string; href: string; leadOnly?: boolean; superOnly?: boolean; badge?: "pending" };

export const DESIGN_NAV: Record<DesignSection, { title: string; items: DesignNavItem[] }> = {
  requester: {
    title: "Design Team",
    items: [
      { label: "Request a design", href: "/design/request" },
      { label: "My requests", href: "/design/my-requests" },
      { label: "All requests", href: "/design/requests" },
      { label: "Campaigns", href: "/design/campaigns" },
    ],
  },
  admin: {
    title: "Design Team Admin",
    items: [
      { label: "Dashboard", href: "/design/admin" },
      { label: "Pending Review", href: "/design/admin/pending", leadOnly: true, badge: "pending" },
      { label: "Board", href: "/design/admin/board" },
      { label: "Library", href: "/design/admin/library" },
      { label: "Calendar", href: "/design/admin/calendar" },
      { label: "Workload", href: "/design/admin/workload", leadOnly: true },
      { label: "Reports", href: "/design/admin/reports", leadOnly: true },
      { label: "Settings", href: "/design/admin/settings", leadOnly: true },
    ],
  },
};

/** A section's menu for someone allowed in it; nothing for anyone else. Lead-only lines need a lead, super-only the Support Admin. */
export function navFor(section: DesignSection, roles: readonly DesignRole[]): DesignNavItem[] {
  if (!SECTION_ROLES[section].some((r) => roles.includes(r))) return [];
  return DESIGN_NAV[section].items.filter((i) => (!i.leadOnly || isLead(roles)) && (!i.superOnly || roles.includes("design_super_admin")));
}
