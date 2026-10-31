/**
 * What the IVR-CRM module is, for the host: its two sections, who may open each, and their menus. Pure data and functions (no server
 * code), so the client sidebars and the unit tests can import it too.
 *
 * The module shows in the hub as two applications, each an ordinary row in Administrator → Applications with its own access grants:
 *   IVR-CRM         URL /ivr         Membership team agents: their own call queue, calls, pipeline and connections
 *   IVR-CRM Admin   URL /ivr/admin   IVR admins: every member and call, import, assignment, analytics, categories
 *
 * Roles:
 *   ivr_agent        anyone who has been given the IVR-CRM application
 *   ivr_admin        the App Admins of the IVR-CRM Admin application who have also been given it (as for every Admin application)
 *   ivr_super_admin  the Support Admin (head_admin) only: also the Smartflo connection (Integrations)
 * The Support Admin holds all three, as they do in Cab Booking and Inventory.
 *
 * Data: an agent sees ONLY their own members (ivr_leads.owner_id) and their own calls (ivr_calls.agent_user_id), everywhere in /ivr, even
 * when they are also an admin. The admin section sees everyone's.
 */

export type IvrRole = "ivr_agent" | "ivr_admin" | "ivr_super_admin";
export type IvrSection = "agent" | "admin";

/** The application rows that stand for each section: their URL is the section's own path. */
export const IVR_USER_URL_PATTERN = "^/ivr/?$";
export const IVR_ADMIN_URL_PATTERN = "^/ivr/admin/?$";

/** The roles that open each section (any one is enough). */
export const SECTION_ROLES: Record<IvrSection, readonly IvrRole[]> = { agent: ["ivr_agent"], admin: ["ivr_admin", "ivr_super_admin"] };

/** A person's roles from what the hub says about them (see the header). */
export function ivrRolesFor(input: { hubRole: string; userAccess: boolean; adminAppAdmin: boolean }): IvrRole[] {
  const head = input.hubRole === "head_admin";
  const roles: IvrRole[] = [];
  if (head || input.userAccess) roles.push("ivr_agent");
  if (head || input.adminAppAdmin) roles.push("ivr_admin");
  if (head) roles.push("ivr_super_admin");
  return roles;
}

/** The role the module's code acts with: the highest one held. Lists are still scoped by section (see the header). */
export function effectiveRole(roles: readonly IvrRole[]): "agent" | "admin" | "super_admin" | null {
  if (roles.includes("ivr_super_admin")) return "super_admin";
  if (roles.includes("ivr_admin")) return "admin";
  if (roles.includes("ivr_agent")) return "agent";
  return null;
}

/** A line of a section's menu. `superOnly`: shown to ivr_super_admin only. */
export type IvrNavItem = { label: string; href: string; superOnly?: boolean };

export const IVR_NAV: Record<IvrSection, { title: string; items: IvrNavItem[] }> = {
  agent: { title: "IVR-CRM", items: [
    { label: "Call queue", href: "/ivr" },
    { label: "My calls", href: "/ivr/calls" },
    { label: "Pipeline", href: "/ivr/pipeline" },
    { label: "Connections", href: "/ivr/connections" },
  ] },
  admin: { title: "IVR-CRM Admin", items: [
    { label: "Team overview", href: "/ivr/admin" },
    { label: "Members and assignment", href: "/ivr/admin/members" },
    { label: "Import members", href: "/ivr/admin/import" },
    { label: "Team calls", href: "/ivr/admin/calls" },
    { label: "Pipeline", href: "/ivr/admin/pipeline" },
    { label: "Analytics", href: "/ivr/admin/analytics" },
    { label: "PDF reports", href: "/ivr/admin/reports" },
    { label: "Categories", href: "/ivr/admin/categories" },
    { label: "Agents", href: "/ivr/admin/agents" },
    { label: "Integrations", href: "/ivr/admin/integrations", superOnly: true },
  ] },
};

/** A section's menu for someone holding one of its roles; nothing for anyone else. Super-only lines need ivr_super_admin. */
export function navFor(section: IvrSection, roles: readonly IvrRole[]): IvrNavItem[] {
  if (!SECTION_ROLES[section].some((r) => roles.includes(r))) return [];
  return IVR_NAV[section].items.filter((i) => !i.superOnly || roles.includes("ivr_super_admin"));
}
