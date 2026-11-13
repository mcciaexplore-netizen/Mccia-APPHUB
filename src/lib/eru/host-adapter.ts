import "server-only";
import { cache } from "react";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { db, rowsOf } from "./db";
import { appAdmins, appStaff, userAppAccess, users, type User } from "@/db/schema";
import { getCurrentUser as hostCurrentUser } from "@/lib/permissions";
import { notifyUsers } from "@/lib/notifications";
import { logError as hostLogError } from "@/lib/log-error";
import { noticeUnread } from "@/lib/notice-feed";
import { writeAudit } from "@/lib/audit";
import { ERU_ADMIN_URL_PATTERN, ERU_USER_URL_PATTERN, eruRolesFor, type EruRole } from "./eru.manifest";

/**
 * The only file in the ERU module that knows about the host: its session, its users, application access (grants, App Admins, App Staff),
 * the bell, its error log and its access audit. Everything else asks here, as in the other modules.
 *
 * ERU's team IS the hub's lists for the ERU application (/eru): App Staff are members, App Admins are admins. The Members page changes those
 * same rows (and the ERU / ERU Admin access grants that go with them), recording each change in the hub's access audit, so Administrator and
 * ERU always agree.
 */

export type EruUser = { id: string; name: string; email: string; roles: EruRole[]; hubRole: User["role"] };
export type Access = { status: "anonymous" } | { status: "ok"; user: EruUser };
export type Person = { id: string; name: string; email: string };
export type TeamMember = Person & { role: "admin" | "member"; designation: string | null };

/** One query: whether the person holds ERU, and whether they are one of its App Admins or App Staff. */
async function standing(userId: string): Promise<{ access: boolean; appAdmin: boolean; appStaff: boolean }> {
  const res = await db.execute(sql`
    select coalesce(bool_or(ua.user_id is not null), false) as access,
      coalesce(bool_or(aa.user_id is not null), false) as app_admin,
      coalesce(bool_or(st.user_id is not null), false) as app_staff
    from apps a
    join departments d on d.id = a.department_id
    left join user_app_access ua on ua.app_id = a.id and ua.user_id = ${userId}
    left join app_admins aa on aa.app_id = a.id and aa.user_id = ${userId}
    left join app_staff st on st.app_id = a.id and st.user_id = ${userId}
    where a.is_active and d.is_active and a.status <> 'unavailable' and a.url ~ ${ERU_USER_URL_PATTERN}`);
  const r = rowsOf<{ access: boolean; app_admin: boolean; app_staff: boolean }>(res)[0];
  return { access: !!r?.access, appAdmin: !!r?.app_admin, appStaff: !!r?.app_staff };
}

/** Who is asking and their roles here (see eru.manifest.ts). Any signed-in hub user is "ok", with or without roles. */
export const resolveAccess = cache(async (): Promise<Access> => {
  const host = await hostCurrentUser();
  if (!host) return { status: "anonymous" };
  const s = await standing(host.id);
  const roles = eruRolesFor({ hubRole: host.role, ...s });
  return { status: "ok", user: { id: host.id, name: host.name, email: host.email, roles, hubRole: host.role } };
});

/** Whether the person is still on the temporary password they were emailed. */
export const needsOwnPassword = async () => !!(await hostCurrentUser())?.mustChangePassword;

/** The ERU application (/eru) and ERU Admin (/eru/admin), as added in Administrator → Applications (the first active one of each). */
async function eruApps(): Promise<{ user: string | null; admin: string | null }> {
  const res = await db.execute(sql`
    select a.id, a.url from apps a join departments d on d.id = a.department_id
    where a.is_active and d.is_active and (a.url ~ ${ERU_USER_URL_PATTERN} or a.url ~ ${ERU_ADMIN_URL_PATTERN})
    order by a.created_at`);
  const rows = rowsOf<{ id: string; url: string }>(res);
  return {
    user: rows.find((r) => new RegExp(ERU_USER_URL_PATTERN).test(r.url))?.id ?? null,
    admin: rows.find((r) => new RegExp(ERU_ADMIN_URL_PATTERN).test(r.url))?.id ?? null,
  };
}

/** The ERU team: active, approved hub users who hold ERU and are on its App Staff or App Admins, by name. */
export async function listTeam(): Promise<TeamMember[]> {
  const { user: appId } = await eruApps();
  if (!appId) return [];
  const res = await db.execute(sql`
    select u.id, u.name, u.email, u.designation, (aa.user_id is not null) as is_admin
    from users u
    join user_app_access ua on ua.user_id = u.id and ua.app_id = ${appId}
    left join app_admins aa on aa.user_id = u.id and aa.app_id = ${appId}
    left join app_staff st on st.user_id = u.id and st.app_id = ${appId}
    where u.is_active and u.status = 'approved' and (aa.user_id is not null or st.user_id is not null)
    order by u.name`);
  return rowsOf<{ id: string; name: string; email: string; designation: string | null; is_admin: boolean }>(res).map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    designation: r.designation,
    role: r.is_admin ? "admin" : "member",
  }));
}

/** Active, approved hub users whose name or email matches, for adding to the team (at most 15). */
export async function searchHubUsers(q: string): Promise<Person[]> {
  const term = q.trim().slice(0, 80);
  if (term.length < 2) return [];
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.isActive, true), eq(users.status, "approved"), or(sql`${users.name} ilike ${like}`, sql`${users.email} ilike ${like}`)))
    .orderBy(asc(users.name))
    .limit(15);
}

/** These hub users (active or not), by id. */
export async function peopleByIds(ids: (string | null | undefined)[]): Promise<Map<string, Person>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map();
  const rows = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, want));
  return new Map(rows.map((r) => [r.id, r]));
}

// ── Changing the team (the Members page) ──────────────────────────────────

/** A problem the admin can fix (shown as is). */
export class MembershipError extends Error {}

type Actor = { id: string; name: string };

async function needApps() {
  const apps = await eruApps();
  if (!apps.user) throw new MembershipError("The ERU application is not set up yet: the Support Admin adds it (URL /eru) in Administrator → Applications.");
  return apps as { user: string; admin: string | null };
}

async function personFor(userId: string) {
  const [p] = await db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(and(eq(users.id, userId), eq(users.isActive, true), eq(users.status, "approved")));
  if (!p) throw new MembershipError("That person is no longer an active hub user. Reload and try again.");
  if (p.role === "head_admin") throw new MembershipError("The Support Admin always has every ERU role; there is nothing to change.");
  return p;
}

async function grant(userId: string, appId: string, actorId: string) {
  await db.insert(userAppAccess).values({ userId, appId, grantedById: actorId, appRole: "user" }).onConflictDoNothing();
}

const audit = (actor: Actor, appId: string, label: string, details: Record<string, unknown>) =>
  writeAudit(actor, [{ action: "eru.members", targetType: "app", targetId: appId, targetLabel: label, details }]);

/**
 * Puts a person in the ERU team as a member (App Staff of ERU) or an admin (App Admin of ERU, plus the ERU Admin tile). Also gives them
 * ERU itself. Already in the team: their role is set to this one.
 */
export async function setTeamRole(actor: Actor, userId: string, role: "admin" | "member"): Promise<{ name: string }> {
  const apps = await needApps();
  const p = await personFor(userId);
  await grant(userId, apps.user, actor.id);
  if (role === "admin") {
    await db.insert(appAdmins).values({ appId: apps.user, userId, addedById: actor.id }).onConflictDoNothing();
    await db.delete(appStaff).where(and(eq(appStaff.appId, apps.user), eq(appStaff.userId, userId)));
    if (apps.admin) await grant(userId, apps.admin, actor.id);
  } else {
    await db.insert(appStaff).values({ appId: apps.user, userId, addedById: actor.id }).onConflictDoNothing();
    await db.delete(appAdmins).where(and(eq(appAdmins.appId, apps.user), eq(appAdmins.userId, userId)));
    if (apps.admin) await db.delete(userAppAccess).where(and(eq(userAppAccess.userId, userId), eq(userAppAccess.appId, apps.admin)));
  }
  await audit(actor, apps.user, "ERU", { person: p.name, role });
  return { name: p.name };
}

/** Takes a person out of the ERU team: off both lists, and ERU and ERU Admin taken away. */
export async function removeFromTeam(actor: Actor, userId: string): Promise<{ name: string }> {
  const apps = await needApps();
  const p = await personFor(userId);
  await db.delete(appStaff).where(and(eq(appStaff.appId, apps.user), eq(appStaff.userId, userId)));
  await db.delete(appAdmins).where(and(eq(appAdmins.appId, apps.user), eq(appAdmins.userId, userId)));
  const appIds = [apps.user, ...(apps.admin ? [apps.admin] : [])];
  await db.delete(userAppAccess).where(and(eq(userAppAccess.userId, userId), inArray(userAppAccess.appId, appIds)));
  await audit(actor, apps.user, "ERU", { person: p.name, role: "removed" });
  return { name: p.name };
}

/** Whether both applications are set up, for the Members page. */
export async function appsSetUp(): Promise<{ user: boolean; admin: boolean }> {
  const a = await eruApps();
  return { user: !!a.user, admin: !!a.admin };
}

// ── The rest of the host ───────────────────────────────────────────────────

/** The hub bell. Never throws. `link` is a page of this site. */
export async function notify(notices: { userId: string; title: string; body?: string; link?: string; key: string }[]): Promise<void> {
  if (!notices.length) return;
  try {
    await notifyUsers(notices.map((n) => ({ userId: n.userId, kind: "eru", title: n.title, body: n.body ?? null, link: n.link ?? null, dedupeKey: `eru:${n.key}` })));
  } catch {
    // a notice that cannot be sent must not undo the change behind it
  }
}

/** How many unread notices the person has (for the hub's bell in the page frame). */
export const unreadNotices = (userId: string) => noticeUnread(userId);

/** The hub's error log (server only). */
export const logError = (message: string, e: unknown) => hostLogError(message, e);
