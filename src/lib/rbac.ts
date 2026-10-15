import type { Role } from "@/db/schema";

/**
 * Who may do what to whom. The ONE place access decisions about people are made: the server actions, the directory queries and the
 * screens all ask here, so a rule can never differ between them. Pure functions (no database), so they are unit-tested directly.
 *
 * Roles, as they exist in the database:
 *   head_admin  Super administrator. Everything. Set in the environment (HEAD_ADMIN_EMAIL), never granted through the screens.
 *   dept_lead   Team manager. Sees and manages the people in their team or reporting to them, and can only give or take away
 *               applications they hold themselves. Cannot create, deactivate or delete people, change roles, or see the audit log.
 *   member      A user. Opens the applications assigned to them.
 */

export type Actor = { id: string; role: Role; teamId: string | null };
export type Target = { id: string; role: Role; teamId: string | null; reportingManagerId: string | null };

/** The roles an administrator may give to someone through the screens. head_admin is never one of them. */
export const ASSIGNABLE_ROLES = ["member", "dept_lead"] as const satisfies readonly Role[];

export const isSuper = (a: Pick<Actor, "role">) => a.role === "head_admin";
export const isTeamManager = (a: Pick<Actor, "role">) => a.role === "dept_lead";
/** Anyone who may use the people-and-access tools at all. */
export const isStaff = (a: Pick<Actor, "role">) => isSuper(a) || isTeamManager(a);

/** Whether `actor` may see and change the application access of `target`. A team manager reaches only plain users in their own scope. */
export function canManageAccess(actor: Actor, target: Target): boolean {
  if (isSuper(actor)) return true;
  if (!isTeamManager(actor)) return false;
  if (target.id === actor.id) return false; // nobody widens their own access
  if (target.role !== "member") return false; // never another manager or an administrator
  return target.reportingManagerId === actor.id || (!!actor.teamId && target.teamId === actor.teamId);
}

/** Whether `actor` may open `target`'s profile (view only). The same reach as managing access, plus oneself. */
export const canViewPerson = (actor: Actor, target: Target) => target.id === actor.id || canManageAccess(actor, target);

export const canImportUsers = (a: Actor) => isSuper(a);
export const canChangeRole = (a: Actor, target: Pick<Target, "id" | "role">) => isSuper(a) && target.id !== a.id && target.role !== "head_admin";
export const canDeactivate = (a: Actor, target: Pick<Target, "id" | "role">) => isSuper(a) && target.id !== a.id;

/**
 * What an actor may do, in one place. The screens read this to decide which buttons to show; the server actions enforce the same rules
 * (with the finer per-person checks above), so a hidden button is never the only protection.
 */
export function capabilities(a: Pick<Actor, "role">) {
  const s = isSuper(a);
  return { create: s, importPeople: s, editPerson: s, changeRole: s, toggleActive: s, remove: s, invite: s, manageOrg: s, viewAudit: s, manageApps: s, assign: isStaff(a) };
}

/**
 * The applications an actor may give or take away. A super administrator: all of them (null means no limit). A team manager: only
 * those they can open themselves, so nobody can hand out more than they hold.
 */
export const grantableApps = (actor: Actor, ownAppIds: ReadonlySet<string>): ReadonlySet<string> | null => (isSuper(actor) ? null : isTeamManager(actor) ? ownAppIds : new Set());

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
