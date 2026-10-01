import "server-only";
import { cache } from "react";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { apps, departments, userAppAccess, type User } from "@/db/schema";

/** What the hub is allowed to know about an app. The URL is deliberately absent. */
export type HubApp = { id: string; name: string; description: string | null; icon: string; departmentId: string };
export type HubDepartment = { id: string; name: string; icon: string };

/**
 * Apps this user may open: active apps in active departments. Head admins get all of them; everyone else
 * only the apps an admin has ticked for them. This is the single source of truth for hub visibility.
 */
export const getAccessibleApps = cache(async (user: Pick<User, "id" | "role">): Promise<HubApp[]> => {
  const cols = { id: apps.id, name: apps.name, description: apps.description, icon: apps.icon, departmentId: apps.departmentId };
  const live = and(eq(apps.isActive, true), eq(departments.isActive, true));
  const base = db.select(cols).from(apps).innerJoin(departments, eq(departments.id, apps.departmentId));
  if (user.role === "head_admin") return base.where(live).orderBy(asc(apps.sortOrder), asc(apps.name));
  return db
    .select(cols)
    .from(apps)
    .innerJoin(departments, eq(departments.id, apps.departmentId))
    .innerJoin(userAppAccess, and(eq(userAppAccess.appId, apps.id), eq(userAppAccess.userId, user.id)))
    .where(live)
    .orderBy(asc(apps.sortOrder), asc(apps.name));
});

/** Departments for the sidebar: those where the user has at least one app. Head admins see every active department. */
export const getVisibleDepartments = cache(async (user: Pick<User, "id" | "role">): Promise<HubDepartment[]> => {
  const [deps, list] = await Promise.all([
    db
      .select({ id: departments.id, name: departments.name, icon: departments.icon })
      .from(departments)
      .where(eq(departments.isActive, true))
      .orderBy(asc(departments.sortOrder), asc(departments.name)),
    getAccessibleApps(user),
  ]);
  if (user.role === "head_admin") return deps;
  const withApps = new Set(list.map((a) => a.departmentId));
  return deps.filter((d) => withApps.has(d.id));
});

/** Resolves an app for launching, or null when it does not exist, is inactive, or the user lacks access. */
export async function getLaunchTarget(user: Pick<User, "id" | "role">, appId: string) {
  const [row] = await db
    .select({ id: apps.id, url: apps.url, departmentId: apps.departmentId })
    .from(apps)
    .innerJoin(departments, eq(departments.id, apps.departmentId))
    .where(and(eq(apps.id, appId), eq(apps.isActive, true), eq(departments.isActive, true)));
  if (!row) return null;
  if (user.role === "head_admin") return row;
  const [grant] = await db
    .select({ id: userAppAccess.id })
    .from(userAppAccess)
    .where(and(eq(userAppAccess.userId, user.id), eq(userAppAccess.appId, appId)));
  return grant ? row : null;
}
