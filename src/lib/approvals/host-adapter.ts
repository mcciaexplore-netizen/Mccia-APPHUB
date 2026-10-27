import "server-only";
import { cache } from "react";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { aprUserRoles } from "@/db/approvals-schema";
import { getCurrentUser as hostCurrentUser } from "@/lib/permissions";
import { ALL_ROLES, type ApprovalsRole } from "./approvals.manifest";

/**
 * The only file in the module that knows about the host: its session and its user table.
 * Everything else asks for these functions, so the module can be mounted in another host by rewriting this one file.
 */

export type { ApprovalsRole };
/** `place`: where this person approves first, from their role in the hub (HR Admin: HR requests, Expense Admin: expenses). */
export type ApprovalsUser = { id: string; name: string; email: string; roles: ApprovalsRole[]; place?: "hr" | "expenditure" | null };
export type DirectoryUser = { id: string; name: string; email: string; headAdmin: boolean; active: boolean };

export type Access =
  | { status: "anonymous" } // not signed in
  | { status: "ok"; user: ApprovalsUser };

const isRole = (r: string): r is ApprovalsRole => (ALL_ROLES as readonly string[]).includes(r);

/**
 * Module roles, from the person's role in the hub. requester: everyone. approvals_admin: the Support Admin (or granted in the module); viewer:
 * granted, and implied for admins. approver: the HR Admin and the Expense Admin, who decide first. dg: the Super Admin, the final approver.
 * There is nothing else to set up: giving someone one of these roles in the hub is what makes them an approver.
 */
async function rolesFor(userId: string, hubRole: string): Promise<ApprovalsRole[]> {
  const granted = await db.select({ role: aprUserRoles.role }).from(aprUserRoles).where(eq(aprUserRoles.userId, userId));
  const roles = new Set<ApprovalsRole>(["requester"]);
  for (const g of granted) if (isRole(g.role)) roles.add(g.role);
  if (hubRole === "head_admin") roles.add("approvals_admin");
  if (hubRole === "super_admin") roles.add("dg");
  if (hubRole === "hr_admin" || hubRole === "expense_admin") roles.add("approver");
  if (roles.has("approvals_admin")) roles.add("viewer");
  return [...roles];
}

/** Who is asking. Approvals is part of the hub, so anyone signed in to the hub may open it: they are a requester, and what else they can do comes from their roles. */
export const resolveAccess = cache(async (): Promise<Access> => {
  const host = await hostCurrentUser();
  if (!host) return { status: "anonymous" };
  const place = host.role === "hr_admin" ? "hr" : host.role === "expense_admin" ? "expenditure" : null;
  return { status: "ok", user: { id: host.id, name: host.name, email: host.email, roles: await rolesFor(host.id, host.role), place } };
});

/** Whether the person is still on the temporary password they were emailed: they must choose their own before using the module. */
export const needsOwnPassword = async () => !!(await hostCurrentUser())?.mustChangePassword;

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
 * Who approves, from the roles in the hub (one person each): the HR Admin (first approver of HR requests), the Expense Admin (first approver
 * of expenses) and the Super Admin (the final approver). A role nobody holds, or held by someone inactive, comes back as null.
 */
export async function roleApprovers(): Promise<{ hr: DirectoryUser | null; expense: DirectoryUser | null; superAdmin: DirectoryUser | null }> {
  const rows = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role }).from(users)
    .where(and(inArray(users.role, ["hr_admin", "expense_admin", "super_admin"]), eq(users.isActive, true), eq(users.status, "approved")));
  const pick = (role: string) => {
    const u = rows.find((r) => r.role === role);
    return u ? { id: u.id, name: u.name, email: u.email, headAdmin: false, active: true } : null;
  };
  return { hr: pick("hr_admin"), expense: pick("expense_admin"), superAdmin: pick("super_admin") };
}
