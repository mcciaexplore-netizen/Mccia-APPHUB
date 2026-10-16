import "server-only";
import { cache } from "react";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { apps, departments, userAppAccess, users } from "@/db/schema";
import { aprApproverRules, aprUserRoles } from "@/db/approvals-schema";
import { ensureEnvAccounts, envAccountEmail } from "@/lib/auth";
import { getCurrentUser as hostCurrentUser } from "@/lib/permissions";
import { ALL_APPS, ALL_ROLES, APP_ENTRY, appsFor, type AppKey, type ApprovalsRole } from "./approvals.manifest";

/**
 * The only file in the module that knows about the host: its session and its user table.
 * Everything else asks for these functions, so the module can be mounted in another host by rewriting this one file.
 */

export type { ApprovalsRole };
/** `apps`: the Approval System applications (HR Approval, Expenditure) this person may open. */
export type ApprovalsUser = { id: string; name: string; email: string; roles: ApprovalsRole[]; apps: AppKey[] };
export type DirectoryUser = { id: string; name: string; email: string; headAdmin: boolean; active: boolean };

export type Access =
  | { status: "anonymous" } // not signed in
  | { status: "ok"; user: ApprovalsUser };

const isRole = (r: string): r is ApprovalsRole => (ALL_ROLES as readonly string[]).includes(r);

/**
 * Module roles. requester: everyone. approvals_admin: the hub's head admin (the Support Admin), or granted in the module. viewer: granted, and
 * implied for admins. approver and dg are not granted: a person is an approver when named on step 1 of an active routing rule, and a dg
 * (the Super Admin, the final approver) when named on a later step, so the rules and the roles can never disagree.
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

/**
 * The Approval System applications the Support Admin has ticked for this person: each one is a row in the hub's application list whose
 * address is the application's entry page (HR Approval, Expenditure Approval), ticked like any other application.
 */
export async function tickedApps(userId: string): Promise<AppKey[]> {
  const rows = await db
    .select({ url: apps.url })
    .from(userAppAccess)
    .innerJoin(apps, eq(apps.id, userAppAccess.appId))
    .innerJoin(departments, eq(departments.id, apps.departmentId))
    .where(and(eq(userAppAccess.userId, userId), eq(apps.isActive, true), eq(departments.isActive, true), inArray(apps.url, ALL_APPS.map((k) => APP_ENTRY[k]))));
  const have = new Set(rows.map((r) => r.url));
  return ALL_APPS.filter((k) => have.has(APP_ENTRY[k]));
}

/** Who is asking. Anyone signed in to the hub is a requester; what else they can do comes from their roles, and which applications they open from what the Support Admin ticked. */
export const resolveAccess = cache(async (): Promise<Access> => {
  const host = await hostCurrentUser();
  if (!host) return { status: "anonymous" };
  const isHeadAdmin = host.role === "head_admin";
  const [roles, ticked] = await Promise.all([rolesFor(host.id, isHeadAdmin), tickedApps(host.id)]);
  // The HR, Expenditure and Super Admin main accounts (set in the environment) are the people the module is built around: both applications, always.
  const email = host.email.toLowerCase();
  const isMain = (["hr", "expenditure", "super"] as const).some((k) => envAccountEmail(k)?.toLowerCase() === email);
  return { status: "ok", user: { id: host.id, name: host.name, email: host.email, roles, apps: isMain ? [...ALL_APPS] : appsFor(roles, ticked) } };
});

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

/**
 * The main accounts that handle approvals, from the environment settings: HR, Expenditure and the Super Admin (the DG). Their rows are
 * made if they do not exist yet. A person who is not set, or is not active, comes back as null.
 */
export async function mainApprovers(): Promise<{ hr: DirectoryUser | null; expenditure: DirectoryUser | null; dg: DirectoryUser | null }> {
  await ensureEnvAccounts();
  const pick = async (key: "hr" | "expenditure" | "super") => {
    const email = envAccountEmail(key);
    if (!email) return null;
    const [u] = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.isActive }).from(users).where(eq(users.email, email));
    return u?.active ? { id: u.id, name: u.name, email: u.email, headAdmin: u.role === "head_admin", active: true } : null;
  };
  const [hr, expenditure, dg] = await Promise.all([pick("hr"), pick("expenditure"), pick("super")]);
  return { hr, expenditure, dg };
}
