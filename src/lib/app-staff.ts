import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { appStaff, apps, users, type User } from "@/db/schema";
import { writeAudit } from "@/lib/audit";
import { isSuper } from "@/lib/rbac";
import { UserError } from "@/lib/user-error";

/**
 * App Staff: who is staff of each application (the "App Staff" section of its Edit form, below App Admins). Only the Support Admin changes
 * it, one person at a time. Like App Admins it does not give access; what it means is up to the application: role "staff" in the single
 * sign-on token (an App Admin who is also App Staff gets "admin").
 */

/** Every application's App Staff: app id → their user ids. */
export async function appStaffByApp(): Promise<Map<string, string[]>> {
  const rows = await db.select({ appId: appStaff.appId, userId: appStaff.userId }).from(appStaff);
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.appId, [...(out.get(r.appId) ?? []), r.userId]);
  return out;
}

/** One application's App Staff, by name. */
export async function getAppStaff(appId: string): Promise<{ id: string; name: string; email: string }[]> {
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(appStaff)
    .innerJoin(users, eq(users.id, appStaff.userId))
    .where(eq(appStaff.appId, appId))
    .orderBy(asc(users.name));
}

const assertSupport = (actor: Pick<User, "role">) => {
  if (!isSuper(actor)) throw new UserError("Only the Support Admin can change an application's staff.");
};

const appName = async (appId: string) => {
  const [app] = await db.select({ name: apps.name }).from(apps).where(eq(apps.id, appId));
  if (!app) throw new UserError("That application no longer exists. Reload and try again.");
  return app.name;
};

/** Makes one person App Staff of one application. They must be an active hub user. Already staff: nothing happens. Audited as app.staff. */
export async function addAppStaffMember(actor: Pick<User, "id" | "name" | "role">, appId: string, userId: string) {
  assertSupport(actor);
  const [name, [person]] = await Promise.all([
    appName(appId),
    db.select({ name: users.name }).from(users).where(and(eq(users.id, userId), eq(users.isActive, true))),
  ]);
  if (!person) throw new UserError("That person is no longer an active user. Reload and try again.");
  const added = await db.insert(appStaff).values({ appId, userId, addedById: actor.id }).onConflictDoNothing().returning({ userId: appStaff.userId });
  if (added.length) await writeAudit(actor, [{ action: "app.staff", targetType: "app", targetId: appId, targetLabel: name, details: { added: [person.name], removed: [] } }]);
  return { added: added.length > 0 };
}

/** Takes one person off an application's App Staff. Not staff: nothing happens. Audited as app.staff. */
export async function removeAppStaffMember(actor: Pick<User, "id" | "name" | "role">, appId: string, userId: string) {
  assertSupport(actor);
  const name = await appName(appId);
  const removed = await db.delete(appStaff).where(and(eq(appStaff.appId, appId), eq(appStaff.userId, userId))).returning({ userId: appStaff.userId });
  if (removed.length) {
    const [person] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
    await writeAudit(actor, [{ action: "app.staff", targetType: "app", targetId: appId, targetLabel: name, details: { added: [], removed: [person?.name ?? "Unknown"] } }]);
  }
  return { removed: removed.length > 0 };
}
