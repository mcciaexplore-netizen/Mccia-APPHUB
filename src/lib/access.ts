import "server-only";
import { cache } from "react";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { apps, departments, userAppAccess, type User } from "@/db/schema";
import { isApprovalsUrl } from "@/lib/approvals/approvals.manifest";
import { hideApprovalsCard } from "@/lib/approvals/flags";
import { isSuper } from "@/lib/rbac";

/** What the hub is allowed to know about an app. The URL is deliberately absent. */
export type HubApp = { id: string; name: string; description: string | null; icon: string; departmentId: string; status: "active" | "testing" | "unavailable" };
export type HubDepartment = { id: string; name: string; icon: string };

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

/** Departments that hold nothing but the old Approvals card. Approvals is a sidebar item now, so such a department is not shown. */
async function approvalsOnlyDepartments(): Promise<Set<string>> {
  const rows = await db.select({ departmentId: apps.departmentId, url: apps.url }).from(apps);
  const count = new Map<string, { all: number; cards: number }>();
  for (const r of rows) {
    const c = count.get(r.departmentId) ?? { all: 0, cards: 0 };
    c.all++;
    if (isApprovalsUrl(r.url)) c.cards++;
    count.set(r.departmentId, c);
  }
  return new Set([...count].filter(([, c]) => c.cards > 0 && c.cards === c.all).map(([id]) => id));
}

/** Departments for the sidebar: those where the user has at least one app. Head admins see every active department. */
export const getVisibleDepartments = cache(async (user: Pick<User, "id" | "role">): Promise<HubDepartment[]> => {
  const [deps, list] = await Promise.all([
    db
      .select({ id: departments.id, name: departments.name, icon: departments.icon })
      .from(departments)
      .where(and(eq(departments.isActive, true), eq(departments.kind, "application")))
      .orderBy(asc(departments.sortOrder), asc(departments.name)),
    isSuper(user) ? Promise.resolve([] as HubApp[]) : getAccessibleApps(user),
  ]);
  if (isSuper(user)) {
    const leftover = await approvalsOnlyDepartments();
    return deps.filter((d) => !leftover.has(d.id));
  }
  const withApps = new Set(list.map((a) => a.departmentId));
  return deps.filter((d) => withApps.has(d.id));
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
