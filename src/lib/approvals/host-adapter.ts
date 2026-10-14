import "server-only";
import { cache } from "react";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { apps, departments, userAppAccess, users } from "@/db/schema";
import { aprApproverRules, aprUserRoles } from "@/db/approvals-schema";
import { logout as hostLogout } from "@/actions/auth";
import { getCurrentUser as hostCurrentUser } from "@/lib/permissions";
import { ALL_ROLES, APPROVALS_URL_PATTERN, type ApprovalsRole } from "./approvals.manifest";

/**
 * The only file in the module that knows about the host: its session, its user table and its app access.
 * Everything else asks for these functions, so the module can be mounted in another host by rewriting this one file.
 */

export type { ApprovalsRole };
export type ApprovalsUser = { id: string; name: string; email: string; roles: ApprovalsRole[] };
export type DirectoryUser = { id: string; name: string; email: string; headAdmin: boolean; active: boolean };

export type Access =
  | { status: "anonymous" } // not signed in
  | { status: "forbidden" } // signed in, but the Approvals card has not been given to this person
  | { status: "ok"; user: ApprovalsUser };

const isRole = (r: string): r is ApprovalsRole => (ALL_ROLES as readonly string[]).includes(r);

/** The hub grants apps one by one (user_app_access); the Approvals card is the active app whose URL is /approvals. */
async function hasCardGrant(userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: userAppAccess.id })
    .from(userAppAccess)
    .innerJoin(apps, eq(apps.id, userAppAccess.appId))
    .innerJoin(departments, eq(departments.id, apps.departmentId))
    .where(and(
      eq(userAppAccess.userId, userId),
      eq(apps.isActive, true),
      eq(departments.isActive, true),
      sql`${apps.url} ~ ${APPROVALS_URL_PATTERN}`,
    ))
    .limit(1);
  return rows.length > 0;
}

/**
 * Module roles. requester: everyone. approvals_admin: the hub's head admin, or granted in the module. viewer: granted, and implied for
 * admins. approver and dg are not granted: a person is an approver when named on step 1 of an active routing rule, and a dg when named on
 * a later step, so the rules and the roles can never disagree.
 */
async function rolesFor(userId: string, isHeadAdmin: boolean): Promise<ApprovalsRole[]> {
  const [granted, steps] = await Promise.all([
    db.select({ role: aprUserRoles.role }).from(aprUserRoles).where(eq(aprUserRoles.userId, userId)),
    db
      .select({ stepNo: aprApproverRules.stepNo })
      .from(aprApproverRules)
      .where(and(eq(aprApproverRules.active, true), sql`${userId}::uuid = any(${aprApproverRules.approverUserIds})`)),
  ]);
  const roles = new Set<ApprovalsRole>(["requester"]);
  for (const g of granted) if (isRole(g.role)) roles.add(g.role);
  if (isHeadAdmin) roles.add("approvals_admin");
  if (roles.has("approvals_admin")) roles.add("viewer");
  for (const s of steps) roles.add(s.stepNo === 1 ? "approver" : "dg");
  return [...roles];
}

/** Who is asking, and whether they may use the module at all. */
export const resolveAccess = cache(async (): Promise<Access> => {
  const host = await hostCurrentUser();
  if (!host) return { status: "anonymous" };
  const isHeadAdmin = host.role === "head_admin";
  if (!isHeadAdmin && !(await hasCardGrant(host.id))) return { status: "forbidden" };
  return { status: "ok", user: { id: host.id, name: host.name, email: host.email, roles: await rolesFor(host.id, isHeadAdmin) } };
});

/** The signed-in person with their module roles, or null when signed out or without access. The host reads its session from cookies, so the request is not needed. */
export async function getCurrentUser(req?: Request): Promise<ApprovalsUser | null> {
  void req;
  const a = await resolveAccess();
  return a.status === "ok" ? a.user : null;
}

/** Everyone who can sign in to the hub, for the Name dropdown and the approver pickers. There is no second user table. */
export async function listUsers(): Promise<DirectoryUser[]> {
  return db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(and(eq(users.isActive, true), eq(users.status, "approved")))
    .orderBy(asc(users.name))
    .then((rows) => rows.map((u) => ({ id: u.id, name: u.name, email: u.email, headAdmin: u.role === "head_admin", active: true })));
}

/** A few people by id, active or not, for naming approvers and notifying them. Missing ids are simply absent from the result. */
export async function getDirectoryUsers(ids: string[]): Promise<DirectoryUser[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.isActive })
    .from(users)
    .where(inArray(users.id, [...new Set(ids)]));
  return rows.map((u) => ({ id: u.id, name: u.name, email: u.email, headAdmin: u.role === "head_admin", active: u.active }));
}

export const hasRole = (user: Pick<ApprovalsUser, "roles"> | null | undefined, role: ApprovalsRole) => !!user && user.roles.includes(role);
export const hasAnyRole = (user: Pick<ApprovalsUser, "roles"> | null | undefined, roles: readonly ApprovalsRole[]) => !!user && roles.some((r) => user.roles.includes(r));

/** Signing out is the host's job; the sidebar passes this to a form. */
export const logout = hostLogout;
