import "server-only";
import { cache } from "react";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { apps, departments, userAppAccess, type User } from "@/db/schema";
import { hideApprovalsCard } from "@/lib/approvals/flags";
import { isSuper } from "@/lib/rbac";

/** What the hub is allowed to know about an app. The URL is deliberately absent. */
export type HubApp = { id: string; name: string; description: string | null; icon: string; departmentId: string; status: "active" | "testing" | "unavailable" };

/**
 * Apps this user may open: active apps in active departments. The Support Admin and the Super Admin get all of them; everyone else (an Admin included)
 * only the apps an admin has ticked for them. This is the single source of truth for hub visibility.
 */
export const getAccessibleApps = cache(async (user: Pick<User, "id" | "role">): Promise<HubApp[]> => {
  const cols = { id: apps.id, name: apps.name, description: apps.description, icon: apps.icon, departmentId: apps.departmentId, status: apps.status };
  const live = and(eq(apps.isActive, true), eq(departments.isActive, true), hideApprovalsCard());
  const base = db.select(cols).from(apps).innerJoin(departments, eq(departments.id, apps.departmentId));
  if (isSuper(user)) return base.where(live).orderBy(asc(apps.sortOrder), asc(apps.name));
  return db
    .select(cols)
    .from(apps)
    .innerJoin(departments, eq(departments.id, apps.departmentId))
    .innerJoin(userAppAccess, and(eq(userAppAccess.appId, apps.id), eq(userAppAccess.userId, user.id)))
    .where(live)
    .orderBy(asc(apps.sortOrder), asc(apps.name));
});


/**
 * Resolves an app for launching, or null when it does not exist, is inactive, or the user lacks access. One query: for everyone but a head
 * admin the grant is part of the join, so a person without it gets exactly the same answer as for an application that does not exist.
 */
export async function getLaunchTarget(user: Pick<User, "id" | "role">, appId: string) {
  const cols = { id: apps.id, url: apps.url, departmentId: apps.departmentId, status: apps.status };
  const live = and(eq(apps.id, appId), eq(apps.isActive, true), eq(departments.isActive, true), hideApprovalsCard());
  const base = db.select(cols).from(apps).innerJoin(departments, eq(departments.id, apps.departmentId));
  const [row] = isSuper(user)
    ? await base.where(live)
    : await db
        .select(cols)
        .from(apps)
        .innerJoin(departments, eq(departments.id, apps.departmentId))
        .innerJoin(userAppAccess, and(eq(userAppAccess.appId, apps.id), eq(userAppAccess.userId, user.id)))
        .where(live);
  return row ?? null;
}
