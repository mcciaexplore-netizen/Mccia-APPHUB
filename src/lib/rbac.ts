import type { Role } from "@/db/schema";

/**
 * Who may do what to whom. The ONE place access decisions about people are made: the server actions, the directory queries and the
 * screens all ask here, so a rule can never differ between them. Pure functions (no database), so they are unit-tested directly.
 *
 * Roles, as they exist in the database:
 *   head_admin   Support Admin. Everything: people, roles, access, applications, settings. The only one who manages accounts. Set in the
 *                environment (SUPPORT_ADMIN_* or HEAD_ADMIN_*), never granted through the screens.
 *   super_admin  Super Admin (the DG). An ordinary user in the hub (only the applications the Support Admin assigns, no Administrator) who
 *                is the final approver in the Approval System: the Recommended Queue.
 *   admin        Admin. Only the areas of Administrator that the Support Admin has switched on for them (see ADMIN_AREAS), and within an
 *                area never: changing roles, deleting people, or touching the Support Admin, Super Admin or another Admin.
 *   dept_lead    Team manager (kept, but nobody needs it). Sees and manages the people in their team or reporting to them, and can only
 *                give or take away applications they hold themselves. Cannot create, deactivate or delete people, change roles, or see the audit log.
 *   member       A user. Opens the applications assigned to them.
 */

/** The parts of Administrator an Admin can be given, one by one. */
export const ADMIN_AREAS = ["people", "import", "org", "apps", "audit", "activity"] as const;
export type AdminArea = (typeof ADMIN_AREAS)[number];

export const AREA_LABEL: Record<AdminArea, { title: string; hint: string }> = {
  people: { title: "Users & access", hint: "Add and edit people, give or take away applications, send setup links, deactivate users" },
  import: { title: "Bulk add", hint: "Import people from a CSV or Excel file" },
  org: { title: "Branches & teams", hint: "Create and change the organisation's branches and teams" },
  apps: { title: "Applications", hint: "Application categories, the application list and the link checks" },
  audit: { title: "Audit log", hint: "See who changed what, and export it" },
  activity: { title: "Activity log", hint: "See which applications people opened, and export it" },
};

// adminAreas is optional so that anyone who is not an Admin (and any caller that has no need for it) can be passed as an Actor as they are.
export type Actor = { id: string; role: Role; teamId: string | null; adminAreas?: readonly string[] };
export type Target = { id: string; role: Role; teamId: string | null; reportingManagerId: string | null };

/** The roles an administrator may give to someone through the Add user form and the import: a User (and the Team manager, which nobody needs). */
export const ASSIGNABLE_ROLES = ["member", "dept_lead"] as const satisfies readonly Role[];
/** The roles only the Support Admin may give, on a person's profile or when adding them. head_admin is never one of them. */
export const PROMOTABLE_ROLES = ["admin", "super_admin", "hr_admin", "expense_admin"] as const satisfies readonly Role[];
/** Roles only one person may hold at a time: the final approver and the two first approvers. */
export const SINGLE_HOLDER_ROLES = ["super_admin", "hr_admin", "expense_admin"] as const satisfies readonly Role[];

/** The Support Admin: full power over the software, and the only one who manages accounts, roles and access. (The Super Admin is not one of these.) */
export const isSuper = (a: Pick<Actor, "role">) => a.role === "head_admin";
export const isSupport = (a: Pick<Actor, "role">) => a.role === "head_admin";
export const isAdminRole = (a: Pick<Actor, "role">) => a.role === "admin";
export const isTeamManager = (a: Pick<Actor, "role">) => a.role === "dept_lead";

/** Whether this person may use one area of Administrator: the Support Admin always, an Admin only when it has been switched on for them. */
export const hasArea = (a: Pick<Actor, "role" | "adminAreas">, area: AdminArea) => isSuper(a) || (isAdminRole(a) && !!a.adminAreas?.includes(area));
/** Whether they may open Administrator at all: the Support Admin, or an Admin with at least one area. */
export const canAdminister = (a: Pick<Actor, "role" | "adminAreas">) => isSuper(a) || (isAdminRole(a) && ADMIN_AREAS.some((x) => a.adminAreas?.includes(x)));
/** Anyone who may use the people-and-access tools at all. */
export const isStaff = (a: Pick<Actor, "role" | "adminAreas">) => isSuper(a) || isTeamManager(a) || hasArea(a, "people");
/** Who may give any application to anyone they can reach (no limit to what they hold themselves). */
export const canGrantAny = (a: Pick<Actor, "role" | "adminAreas">) => isSuper(a) || hasArea(a, "people");

/** The people an Admin may reach: plain users (and Team managers), never an Admin, the Support Admin or the Super Admin. */
const reachableByAdmin = (target: Pick<Target, "role">) => target.role === "member" || target.role === "dept_lead";

/** Whether `actor` may see and change the application access of `target`. A team manager reaches only plain users in their own scope. */
export function canManageAccess(actor: Actor, target: Target): boolean {
  if (isSuper(actor)) return true;
  if (target.id === actor.id) return false; // nobody widens their own access
  if (isAdminRole(actor)) return hasArea(actor, "people") && reachableByAdmin(target);
  if (!isTeamManager(actor)) return false;
  if (target.role !== "member") return false; // never another manager or an administrator
  return target.reportingManagerId === actor.id || (!!actor.teamId && target.teamId === actor.teamId);
}

/** Whether `actor` may open `target`'s profile (view only). The same reach as managing access, plus oneself. */
export const canViewPerson = (actor: Actor, target: Target) => target.id === actor.id || canManageAccess(actor, target);

export const canImportUsers = (a: Actor) => hasArea(a, "import");
/** Whether an import may update an account that already exists: anyone for the two top roles, plain users only for an Admin with Bulk add. */
export const canUpdateByImport = (a: Actor, target: Pick<Target, "role">) => isSuper(a) || (hasArea(a, "import") && reachableByAdmin(target));
/** Only the Support Admin changes roles, never their own and never another Support Admin's. */
export const canChangeRole = (a: Actor, target: Pick<Target, "id" | "role">) => isSupport(a) && target.id !== a.id && target.role !== "head_admin";
/** Nobody deactivates themselves. The Support Admin may deactivate anyone else (the last active Support Admin is protected by the action itself). */
export const canDeactivate = (a: Actor, target: Pick<Target, "id" | "role">) =>
  target.id !== a.id && (isSuper(a) || (hasArea(a, "people") && reachableByAdmin(target)));
/** Whether `actor` may edit this person's details (name, department, team and so on). */
export const canEditPerson = (a: Actor, target: Pick<Target, "id" | "role">) => isSuper(a) || (hasArea(a, "people") && reachableByAdmin(target));

/**
 * What an actor may do, in one place. The screens read this to decide which buttons to show; the server actions enforce the same rules
 * (with the finer per-person checks above), so a hidden button is never the only protection.
 */
export function capabilities(a: Pick<Actor, "role" | "adminAreas">) {
  const people = hasArea(a, "people");
  return {
    create: people, importPeople: hasArea(a, "import"), editPerson: people, changeRole: isSupport(a), toggleActive: people, remove: isSuper(a), invite: people,
    manageOrg: hasArea(a, "org"), viewAudit: hasArea(a, "audit"), manageApps: hasArea(a, "apps"), assign: isStaff(a),
  };
}

/**
 * The applications an actor may give or take away. A top role, or an Admin with Users & access: all of them (null means no limit). A team
 * manager: only those they can open themselves, so nobody can hand out more than they hold.
 */
export const grantableApps = (actor: Actor, ownAppIds: ReadonlySet<string>): ReadonlySet<string> | null => (canGrantAny(actor) ? null : isTeamManager(actor) ? ownAppIds : new Set());

/** The first app in `wanted` the actor may not grant, or null when all are fine. */
export function firstUngrantable(grantable: ReadonlySet<string> | null, wanted: readonly string[]): string | null {
  if (grantable === null) return null;
  return wanted.find((id) => !grantable.has(id)) ?? null;
}

/** Walks up the reporting chain from `managerId` to see whether it would loop back to `personId`. `managerOf` maps a person to their manager. */
export function wouldCreateCycle(personId: string, managerId: string | null, managerOf: (id: string) => string | null | undefined): boolean {
  const seen = new Set<string>();
  let cur: string | null | undefined = managerId;
  while (cur) {
    if (cur === personId) return true;
    if (seen.has(cur)) return true; // an existing loop above them: refuse rather than extend it
    seen.add(cur);
    cur = managerOf(cur);
  }
  return false;
}
