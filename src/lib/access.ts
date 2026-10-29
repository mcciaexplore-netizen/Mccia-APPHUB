import "server-only";
import { cache } from "react";
import { and, asc, count, eq, inArray, max } from "drizzle-orm";
import { db } from "@/db";
import { activityLog, apps, departments, userAppAccess, type User } from "@/db/schema";
import { hideApprovalsCard } from "@/lib/approvals/flags";
import { isSuper } from "@/lib/rbac";

/**
 * What the hub is allowed to know about an app. The URL is deliberately absent. `ssoSlug` is set only for an application with single sign-on
 * switched on: its card then opens /launch/<ssoSlug> instead of /go/<id>. (The callback address stays on the server.)
 */
export type HubApp = { id: string; name: string; description: string | null; icon: string; departmentId: string; status: "active" | "testing" | "unavailable"; ssoSlug: string | null };

/**
 * Apps this user may open: active apps in active departments. The Support Admin and the Super Admin get all of them; everyone else (an Admin included)
 * only the apps an admin has ticked for them. This is the single source of truth for hub visibility.
 */
export const getAccessibleApps = cache(async (user: Pick<User, "id" | "role">): Promise<HubApp[]> => {
  const cols = { id: apps.id, name: apps.name, description: apps.description, icon: apps.icon, departmentId: apps.departmentId, status: apps.status, ssoEnabled: apps.ssoEnabled, ssoSlug: apps.ssoSlug };
  const live = and(eq(apps.isActive, true), eq(departments.isActive, true), hideApprovalsCard());
  const base = db.select(cols).from(apps).innerJoin(departments, eq(departments.id, apps.departmentId));
  const rows = isSuper(user)
    ? await base.where(live).orderBy(asc(apps.sortOrder), asc(apps.name))
    : await db
        .select(cols)
        .from(apps)
        .innerJoin(departments, eq(departments.id, apps.departmentId))
        .innerJoin(userAppAccess, and(eq(userAppAccess.appId, apps.id), eq(userAppAccess.userId, user.id)))
        .where(live)
        .orderBy(asc(apps.sortOrder), asc(apps.name));
  return rows.map(({ ssoEnabled, ssoSlug, ...a }): HubApp => ({ ...a, ssoSlug: ssoEnabled ? ssoSlug : null }));
});


/**
 * Resolves an app for launching, or null when it does not exist, is inactive, or the user lacks access. One query: for everyone but a head
 * admin the grant is part of the join, so a person without it gets exactly the same answer as for an application that does not exist.
 */
export async function getLaunchTarget(user: Pick<User, "id" | "role">, appId: string) {
  const cols = { id: apps.id, url: apps.url, departmentId: apps.departmentId, status: apps.status, ssoEnabled: apps.ssoEnabled, ssoSlug: apps.ssoSlug };
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

/**
 * Resolves a single sign-on application by its slug for /launch/<slug>, or null when there is no such application, single sign-on is not
 * switched on for it, or it (or its department) is inactive: all of those are "not found". Unlike getLaunchTarget it also says whether
 * this person may open it, so the route can answer "no access" differently from "not found". The Support Admin may open every one;
 * everyone else needs a grant.
 */
export async function getSsoTarget(user: Pick<User, "id" | "role">, slug: string) {
  const [row] = await db
    .select({
      id: apps.id, name: apps.name, url: apps.url, departmentId: apps.departmentId, status: apps.status, callbackUrl: apps.ssoCallbackUrl,
      grantId: userAppAccess.id,
    })
    .from(apps)
    .innerJoin(departments, eq(departments.id, apps.departmentId))
    .leftJoin(userAppAccess, and(eq(userAppAccess.appId, apps.id), eq(userAppAccess.userId, user.id)))
    .where(and(eq(apps.ssoSlug, slug), eq(apps.ssoEnabled, true), eq(apps.isActive, true), eq(departments.isActive, true), hideApprovalsCard()));
  if (!row) return null;
  const { grantId, ...app } = row;
  return { ...app, hasAccess: isSuper(user) || grantId !== null };
}

/**
 * What the home page's cards say about each application, from real records: its category's name, when this person last opened it, and,
 * for those who manage access, how many people have been given it.
 */
export async function cardFacts(userId: string, appIds: string[], withPeople: boolean) {
  if (appIds.length === 0) return { category: new Map<string, string>(), lastOpened: new Map<string, Date>(), people: new Map<string, number>() };
  const [cats, opens, people] = await Promise.all([
    db.select({ id: apps.id, name: departments.name }).from(apps).innerJoin(departments, eq(departments.id, apps.departmentId)).where(inArray(apps.id, appIds)),
    db.select({ appId: activityLog.appId, at: max(activityLog.openedAt) }).from(activityLog)
      .where(and(eq(activityLog.userId, userId), eq(activityLog.action, "launch"), inArray(activityLog.appId, appIds))).groupBy(activityLog.appId),
    withPeople
      ? db.select({ appId: userAppAccess.appId, n: count() }).from(userAppAccess).where(inArray(userAppAccess.appId, appIds)).groupBy(userAppAccess.appId)
      : Promise.resolve([] as { appId: string; n: number }[]),
  ]);
  return {
    category: new Map(cats.map((c) => [c.id, c.name])),
    lastOpened: new Map(opens.filter((o) => o.appId && o.at).map((o) => [o.appId!, o.at!])),
    people: new Map(people.map((p) => [p.appId, p.n])),
  };
}
