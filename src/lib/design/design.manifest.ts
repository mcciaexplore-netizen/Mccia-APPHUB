/**
 * What the DesignDesk module is, for the host: its sections, who may open each, and their menus. Pure data and functions (no server code),
 * so the client sidebars and the unit tests can import it too.
 *
 * The module shows in the hub as two applications, each an ordinary row in Administrator → Applications with its own access grants:
 *   Design Team         URL /design         designers: their own queue, board, tickets, library and calendar
 *   Design Team Admin   URL /design/admin   design leads: every ticket, the Pending Review queue, workload, reports, settings
 * The request pages (/design/request, /design/my-requests, /design/requests, /design/campaigns) are open to every signed-in hub user,
 * without either application. The review and tracking links (/review/<token>, /track/<token>) work without signing in.
 *
 * Roles:
 *   design_member       anyone given the Design Team application
 *   design_lead         anyone given the Design Team Admin application, whatever their hub role
 *   design_super_admin  the Support Admin (head_admin) only: also Integrations (email test, Slack) and "Delete all past data"
 *
 * Data: in /design a member sees ONLY tickets assigned to them, everywhere (dashboard, board, calendar, ticket pages), even when they are
 * also a lead. The admin section sees every ticket. A requester sees only the requests they made.
 */

export type DesignRole = "design_member" | "design_lead" | "design_super_admin";
export type DesignSection = "team" | "admin" | "requester";

export const DESIGN_TEAM_URL_PATTERN = "^/design/?$";
export const DESIGN_ADMIN_URL_PATTERN = "^/design/admin/?$";

export const SECTION_ROLES: Record<"team" | "admin", readonly DesignRole[]> = {
  team: ["design_member"],
  admin: ["design_lead", "design_super_admin"],
};

/** A person's roles from what the hub says about them (see the header). */
export function designRolesFor(input: { hubRole: string; teamAccess: boolean; adminAccess: boolean }): DesignRole[] {
  const head = input.hubRole === "head_admin";
  const roles: DesignRole[] = [];
  if (head || input.teamAccess) roles.push("design_member");
  if (head || input.adminAccess) roles.push("design_lead");
  if (head) roles.push("design_super_admin");
  return roles;
}

export const isLead = (roles: readonly DesignRole[]) => roles.includes("design_lead") || roles.includes("design_super_admin");
export const isMember = (roles: readonly DesignRole[]) => roles.includes("design_member");

export type DesignNavItem = { label: string; href: string; superOnly?: boolean; badge?: "pending" };

export const DESIGN_NAV: Record<DesignSection, { title: string; items: DesignNavItem[] }> = {
  team: {
    title: "Design Team",
    items: [
      { label: "My Dashboard", href: "/design" },
      { label: "Board", href: "/design/board" },
      { label: "Library", href: "/design/library" },
      { label: "Calendar", href: "/design/calendar" },
      { label: "My Requests", href: "/design/my-requests" },
    ],
  },
  admin: {
    title: "Design Team Admin",
    items: [
      { label: "Dashboard", href: "/design/admin" },
      { label: "Pending Review", href: "/design/admin/pending", badge: "pending" },
      { label: "Board", href: "/design/admin/board" },
      { label: "Workload", href: "/design/admin/workload" },
      { label: "Reports", href: "/design/admin/reports" },
      { label: "Settings", href: "/design/admin/settings" },
    ],
  },
  requester: {
    title: "Design Requests",
    items: [
      { label: "Request a design", href: "/design/request" },
      { label: "My requests", href: "/design/my-requests" },
      { label: "All requests", href: "/design/requests" },
      { label: "Campaigns", href: "/design/campaigns" },
    ],
  },
};

/** A section's menu for someone allowed in it; the requester menu is everyone's. */
export function navFor(section: DesignSection, roles: readonly DesignRole[]): DesignNavItem[] {
  if (section !== "requester" && !SECTION_ROLES[section].some((r) => roles.includes(r))) return [];
  return DESIGN_NAV[section].items.filter((i) => !i.superOnly || roles.includes("design_super_admin"));
}
