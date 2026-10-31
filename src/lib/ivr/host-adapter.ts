import "server-only";
import { cache } from "react";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db, rowsOf } from "./db";
import { users } from "@/db/schema";
import { agentProfiles } from "@/db/ivr-schema";
import { getCurrentUser as hostCurrentUser } from "@/lib/permissions";
import { IVR_ADMIN_URL_PATTERN, IVR_USER_URL_PATTERN, effectiveRole, ivrRolesFor, type IvrRole } from "./ivr.manifest";

/**
 * The only file in the IVR-CRM module that knows about the host: its session, its users and its application access. Everything else asks
 * here, the same way Cab Booking and Inventory do (src/lib/cabs/host-adapter.ts).
 */

export type { IvrRole };
/** The hub's users table, for the module's joins that show a person's name or email. Nothing in the module writes to it. */
export { users as hubUsers };

export type IvrUser = { id: string; name: string; email: string; roles: IvrRole[]; role: "agent" | "admin" | "super_admin" | null; hubRole: string };
export type Access = { status: "anonymous" } | { status: "ok"; user: IvrUser };

/** The users given the active IVR-CRM application, who are active hub users: the agents. As SQL, for queries that filter on them. */
const agentIdsSql = sql`select ua.user_id from user_app_access ua
  join apps a on a.id = ua.app_id
  join departments d on d.id = a.department_id
  join users u on u.id = ua.user_id
  where a.is_active and d.is_active and a.status <> 'unavailable' and a.url ~ ${IVR_USER_URL_PATTERN} and u.is_active and u.status = 'approved'`;

/** `column in (the agents)`: for raw SQL and query-builder filters alike. */
export const isIvrAgent = (column: SQL | ReturnType<typeof sql.raw> | typeof users.id): SQL => sql`${column} in (${agentIdsSql})`;

/**
 * One query: whether the person has been given the IVR-CRM application (URL /ivr), and whether they are an App Admin of the IVR-CRM Admin
 * application (URL /ivr/admin) and have been given it (being an App Admin does not give access, as everywhere in the hub). Only active
 * applications in active categories count, and not one marked Unavailable (the head admin, who opens it to test, does not depend on this).
 */
async function ivrStanding(userId: string): Promise<{ userAccess: boolean; adminAppAdmin: boolean }> {
  const res = await db.execute(sql`
    select coalesce(bool_or(a.url ~ ${IVR_USER_URL_PATTERN} and ua.user_id is not null), false) as user_access,
      coalesce(bool_or(a.url ~ ${IVR_ADMIN_URL_PATTERN} and ua.user_id is not null and ad.user_id is not null), false) as admin_app_admin
    from apps a
    join departments d on d.id = a.department_id
    left join user_app_access ua on ua.app_id = a.id and ua.user_id = ${userId}
    left join app_admins ad on ad.app_id = a.id and ad.user_id = ${userId}
    where a.is_active and d.is_active and a.status <> 'unavailable' and (a.url ~ ${IVR_USER_URL_PATTERN} or a.url ~ ${IVR_ADMIN_URL_PATTERN})`);
  const r = rowsOf<{ user_access: boolean; admin_app_admin: boolean }>(res)[0];
  return { userAccess: !!r?.user_access, adminAppAdmin: !!r?.admin_app_admin };
}

/** Who is asking and their roles here (see ivr.manifest.ts). Someone signed in with no role at all is still "ok", with no roles. */
export const resolveAccess = cache(async (): Promise<Access> => {
  const host = await hostCurrentUser();
  if (!host) return { status: "anonymous" };
  const standing = await ivrStanding(host.id);
  const roles = ivrRolesFor({ hubRole: host.role, userAccess: standing.userAccess, adminAppAdmin: standing.adminAppAdmin });
  return { status: "ok", user: { id: host.id, name: host.name, email: host.email, roles, role: effectiveRole(roles), hubRole: host.role } };
});

/** Whether the person is still on the temporary password they were emailed: they must choose their own before using the module. */
export const needsOwnPassword = async () => !!(await hostCurrentUser())?.mustChangePassword;

export const hasAnyRole = (user: Pick<IvrUser, "roles"> | null | undefined, roles: readonly IvrRole[]) => !!user && roles.some((r) => user.roles.includes(r));

/** An agent with what IVR-CRM keeps about them: where Smartflo rings them (their profile phone, else their hub phone) and their Smartflo agent. */
export type IvrAgent = { id: string; name: string; email: string; phone: string | null; softphoneExtension: string | null; smartfloAgentId: string | null };

const agentCols = {
  id: users.id,
  name: users.name,
  email: users.email,
  phone: sql<string | null>`coalesce(${agentProfiles.phone}, ${users.phone})`,
  softphoneExtension: agentProfiles.softphoneExtension,
  smartfloAgentId: agentProfiles.smartfloAgentId,
};

/** Everyone given the IVR-CRM application (the agents), by name. */
export async function listIvrAgents(): Promise<IvrAgent[]> {
  return db.select(agentCols).from(users).leftJoin(agentProfiles, eq(agentProfiles.userId, users.id)).where(isIvrAgent(users.id)).orderBy(asc(users.name));
}

/** These people (agents or not, active or not), with what IVR-CRM keeps about them. For matching calls to whoever handled them. */
export async function listPeople(ids?: string[]): Promise<IvrAgent[]> {
  if (ids && !ids.length) return [];
  const q = db.select(agentCols).from(users).leftJoin(agentProfiles, eq(agentProfiles.userId, users.id));
  return ids ? q.where(inArray(users.id, ids)) : q.where(sql`${users.id} in (select user_id from ivr_agent_profiles)`);
}

/**
 * The people a Smartflo call can belong to: everyone given IVR-CRM, plus anyone who has an IVR-CRM profile (an agent whose access was
 * taken away keeps their past calls). Other hub users never count, so another department's call is never pinned on someone by phone.
 */
export async function listCallers(): Promise<IvrAgent[]> {
  const [agents, profiled] = await Promise.all([listIvrAgents(), listPeople()]);
  const byId = new Map(profiled.map((p) => [p.id, p]));
  for (const a of agents) byId.set(a.id, a);
  return [...byId.values()];
}

/** One person with their IVR-CRM profile, or null. */
export async function personById(id: string): Promise<IvrAgent | null> {
  const [p] = await listPeople([id]);
  return p ?? null;
}

/** Whether this hub user is an agent now (given IVR-CRM, active). */
export async function isAgentNow(userId: string): Promise<boolean> {
  const [r] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), isIvrAgent(users.id))).limit(1);
  return !!r;
}

/** Names of these hub users, by id. */
export async function namesOf(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Writes part of a person's IVR-CRM profile, making the row on first use. */
export async function saveProfile(userId: string, patch: Partial<{ phone: string | null; softphoneExtension: string | null; smartfloAgentId: string | null }>) {
  await db
    .insert(agentProfiles)
    .values({ userId, ...patch, updatedAt: new Date() })
    .onConflictDoUpdate({ target: agentProfiles.userId, set: { ...patch, updatedAt: new Date() } });
}

/** Clears a Smartflo agent link from whoever holds it (when that agent is linked to someone else). */
export async function clearSmartfloLink(agentId: string, exceptUserId?: string) {
  await db
    .update(agentProfiles)
    .set({ smartfloAgentId: null, updatedAt: new Date() })
    .where(and(eq(agentProfiles.smartfloAgentId, agentId), exceptUserId ? sql`${agentProfiles.userId} <> ${exceptUserId}` : undefined));
}
