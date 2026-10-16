import "server-only";
import { and, asc, count, desc, eq, exists, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { activityLog, apps, branches, teams, userAppAccess, userInvites, users, type Role, type User } from "@/db/schema";
import { accountStatus, type AccountStatus } from "@/lib/account-status";
import { isEnvAdmin } from "@/lib/auth";
import { MAX_PEOPLE } from "@/lib/access-ops";
import { canViewPerson, hasArea, isAdminRole, isSuper, isTeamManager, type Actor } from "@/lib/rbac";
import { UserError } from "@/lib/user-error";

/**
 * The people directory: searching, filtering, sorting and paging all happen in the database, so it stays quick with thousands of
 * accounts, and the same scope rule limits every query. A super administrator sees everyone; a team manager sees only the plain
 * users in their team or reporting to them; anyone else sees no one.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PEOPLE_PAGE = 25;
const SORTS = ["name", "email", "lastLogin", "created"] as const;
type PeopleSort = (typeof SORTS)[number];

export type PeopleFilters = {
  q?: string; branchId?: string; teamId?: string; managerId?: string; appId?: string;
  role?: Role; status?: AccountStatus; sort: PeopleSort; dir: "asc" | "desc"; page: number;
};

export function parsePeopleFilters(sp: Record<string, string | string[] | undefined>): PeopleFilters {
  const g = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : undefined);
  const id = (k: string) => { const v = g(k); return v && UUID.test(v) ? v : undefined; };
  const role = g("role");
  const status = g("status");
  const sort = g("sort");
  return {
    q: g("q") || undefined, branchId: id("branch"), teamId: id("team"), managerId: id("manager"), appId: id("app"),
    role: role === "head_admin" || role === "super_admin" || role === "admin" || role === "dept_lead" || role === "member" ? role : undefined,
    status: status === "active" || status === "inactive" || status === "pending" ? status : undefined,
    sort: (SORTS as readonly string[]).includes(sort ?? "") ? (sort as PeopleSort) : "name",
    dir: g("dir") === "desc" ? "desc" : "asc",
    page: Math.max(1, Math.min(100000, Number(g("page")) || 1)),
  };
}

/** The rule every query starts from: which people this actor may see at all. */
function scope(actor: Actor): SQL | undefined {
  if (isSuper(actor)) return undefined;
  // An Admin with Users & access sees plain users (and Team managers) and themselves: never the Support Admin, the Super Admin or another Admin.
  if (isAdminRole(actor)) return hasArea(actor, "people") ? or(inArray(users.role, ["member", "dept_lead"]), eq(users.id, actor.id)) : sql`false`;
  if (!isTeamManager(actor)) return sql`false`;
  const reach = [eq(users.reportingManagerId, actor.id)];
  if (actor.teamId) reach.push(eq(users.teamId, actor.teamId));
  return and(eq(users.role, "member"), ne(users.id, actor.id), or(...reach));
}

const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const hasLoginRoute = sql`(${users.passwordHash} is not null or ${users.signupSource} = 'env')`;

function filterSql(f: Partial<PeopleFilters>): SQL[] {
  const c: SQL[] = [];
  if (f.q) c.push(or(ilike(users.name, like(f.q)), ilike(users.email, like(f.q)), ilike(users.designation, like(f.q)))!);
  if (f.branchId) c.push(eq(users.branchId, f.branchId));
  if (f.teamId) c.push(eq(users.teamId, f.teamId));
  if (f.managerId) c.push(eq(users.reportingManagerId, f.managerId));
  if (f.role) c.push(eq(users.role, f.role));
  if (f.status === "inactive") c.push(eq(users.isActive, false));
  if (f.status === "active") c.push(and(eq(users.isActive, true), hasLoginRoute)!);
  if (f.status === "pending") c.push(and(eq(users.isActive, true), sql`not ${hasLoginRoute}`)!);
  if (f.appId) c.push(exists(db.select({ x: sql`1` }).from(userAppAccess).where(and(eq(userAppAccess.userId, users.id), eq(userAppAccess.appId, f.appId)))));
  return c;
}

export type PersonRow = {
  id: string; name: string; email: string; designation: string | null; role: Role; isActive: boolean; status: AccountStatus; mainAdmin: boolean; passwordInSettings: boolean;
  branch: string | null; team: string | null; manager: string | null; lastLoginAt: Date | null; createdAt: Date;
  apps: { id: string; name: string; active: boolean }[];
};

const manager = alias(users, "manager");

export async function listPeople(actor: Actor, f: PeopleFilters, pageSize = PEOPLE_PAGE): Promise<{ rows: PersonRow[]; total: number; pages: number; page: number }> {
  const where = and(scope(actor), ...filterSql(f));
  const dir = f.dir === "desc" ? desc : asc;
  const order =
    f.sort === "email" ? [dir(users.email)]
    : f.sort === "created" ? [dir(users.createdAt)]
    : f.sort === "lastLogin" ? [f.dir === "desc" ? sql`${users.lastLoginAt} desc nulls last` : sql`${users.lastLoginAt} asc nulls last`, asc(users.name)]
    : [dir(users.name), asc(users.email)];

  const [[{ total }], page] = await Promise.all([
    db.select({ total: count() }).from(users).where(where),
    Promise.resolve(f.page),
  ]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pages);

  const base = await db
    .select({
      id: users.id, name: users.name, email: users.email, designation: users.designation, role: users.role, isActive: users.isActive,
      hasPassword: sql<boolean>`${users.passwordHash} is not null`, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt,
      branch: branches.name, team: teams.name, manager: manager.name,
    })
    .from(users)
    .leftJoin(branches, eq(branches.id, users.branchId))
    .leftJoin(teams, eq(teams.id, users.teamId))
    .leftJoin(manager, eq(manager.id, users.reportingManagerId))
    .where(where)
    .orderBy(...order)
    .limit(pageSize)
    .offset((current - 1) * pageSize);

  const grants = base.length
    ? await db
        .select({ userId: userAppAccess.userId, id: apps.id, name: apps.name, active: apps.isActive })
        .from(userAppAccess)
        .innerJoin(apps, eq(apps.id, userAppAccess.appId))
        .where(inArray(userAppAccess.userId, base.map((b) => b.id)))
        .orderBy(asc(apps.name))
    : [];
  const byUser = new Map<string, PersonRow["apps"]>();
  for (const g of grants) (byUser.get(g.userId) ?? byUser.set(g.userId, []).get(g.userId)!).push({ id: g.id, name: g.name, active: g.active });

  const rows = base.map((b): PersonRow => {
    // A main admin is the account set in the environment (the Support Admin) and the Super Admin: neither can be deactivated or deleted here.
    const passwordInSettings = isEnvAdmin(b.email);
    const mainAdmin = passwordInSettings || b.role === "super_admin";
    return {
      id: b.id, name: b.name, email: b.email, designation: b.designation, role: b.role, isActive: b.isActive, mainAdmin, passwordInSettings,
      status: accountStatus({ isActive: b.isActive, hasPassword: b.hasPassword, passwordInSettings }),
      branch: b.branch, team: b.team, manager: b.manager, lastLoginAt: b.lastLoginAt, createdAt: b.createdAt,
      apps: byUser.get(b.id) ?? [],
    };
  });
  return { rows, total, pages, page: current };
}

/** Who a bulk action applies to: people picked by hand, plus everyone in the chosen team, branch or reporting line, plus an optional filter. */
export type TargetSpec = { ids?: string[]; teamId?: string; branchId?: string; managerId?: string; filters?: Partial<PeopleFilters> };

export async function peopleIds(actor: Actor, spec: TargetSpec): Promise<string[]> {
  const groups: SQL[] = [];
  if (spec.teamId) groups.push(eq(users.teamId, spec.teamId));
  if (spec.branchId) groups.push(eq(users.branchId, spec.branchId));
  if (spec.managerId) groups.push(eq(users.reportingManagerId, spec.managerId));
  if (spec.filters) {
    const f = filterSql(spec.filters);
    if (f.length) groups.push(and(...f)!);
  }
  const ids = new Set(spec.ids ?? []);
  if (groups.length) {
    const rows = await db.select({ id: users.id }).from(users).where(and(scope(actor), or(...groups))).limit(MAX_PEOPLE + 1);
    for (const r of rows) ids.add(r.id);
  }
  if (ids.size > MAX_PEOPLE) throw new UserError(`That is more than ${MAX_PEOPLE} people. Narrow the selection.`);
  return [...ids];
}

export type PersonDetail = {
  id: string; name: string; email: string; designation: string | null; phone: string | null; role: Role; adminAreas: string[]; isActive: boolean; status: AccountStatus; mainAdmin: boolean; passwordInSettings: boolean;
  branchId: string | null; teamId: string | null; managerId: string | null;
  branch: string | null; team: string | null; manager: string | null;
  lastLoginAt: Date | null; createdAt: Date; appIds: string[];
  invite: { delivery: string; expiresAt: Date; state: "used" | "expired" | "open" } | null;
  launches: { app: string | null; at: Date }[];
};

/** One person's complete configuration in one read, or null when this actor may not see them (the page then shows "not found"). */
export async function getPerson(actor: User, id: string): Promise<PersonDetail | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db
    .select({
      u: users, branch: branches.name, team: teams.name, manager: manager.name,
    })
    .from(users)
    .leftJoin(branches, eq(branches.id, users.branchId))
    .leftJoin(teams, eq(teams.id, users.teamId))
    .leftJoin(manager, eq(manager.id, users.reportingManagerId))
    .where(eq(users.id, id));
  if (!row) return null;
  const u = row.u;
  if (!canViewPerson(actor, { id: u.id, role: u.role, teamId: u.teamId, reportingManagerId: u.reportingManagerId })) return null;

  const [grants, [invite], launches] = await Promise.all([
    db.select({ appId: userAppAccess.appId }).from(userAppAccess).where(eq(userAppAccess.userId, id)),
    db.select({ delivery: userInvites.delivery, expiresAt: userInvites.expiresAt, usedAt: userInvites.usedAt }).from(userInvites).where(eq(userInvites.userId, id)).orderBy(desc(userInvites.createdAt)).limit(1),
    db.select({ app: apps.name, at: activityLog.openedAt }).from(activityLog).leftJoin(apps, eq(apps.id, activityLog.appId)).where(and(eq(activityLog.userId, id), eq(activityLog.action, "launch"))).orderBy(desc(activityLog.openedAt)).limit(8),
  ]);
  const passwordInSettings = isEnvAdmin(u.email);
  const mainAdmin = passwordInSettings || u.role === "super_admin";
  return {
    id: u.id, name: u.name, email: u.email, designation: u.designation, phone: u.phone, role: u.role, adminAreas: u.adminAreas, isActive: u.isActive, mainAdmin, passwordInSettings,
    status: accountStatus({ isActive: u.isActive, hasPassword: !!u.passwordHash, passwordInSettings }),
    branchId: u.branchId, teamId: u.teamId, managerId: u.reportingManagerId,
    branch: row.branch, team: row.team, manager: row.manager,
    lastLoginAt: u.lastLoginAt, createdAt: u.createdAt, appIds: grants.map((g) => g.appId), launches,
    invite: invite ? { delivery: invite.delivery, expiresAt: invite.expiresAt, state: invite.usedAt ? "used" : invite.expiresAt.getTime() < Date.now() ? "expired" : "open" } : null,
  };
}

/** Real counts for the administrator's dashboard. Nothing here is estimated or made up. */
export async function adminSummary() {
  const [[u], [a], [{ branchesN }], [{ teamsN }]] = await Promise.all([
    db.select({
      total: count(),
      active: sql<number>`count(*) filter (where ${users.isActive} and ${hasLoginRoute})`.mapWith(Number),
      pending: sql<number>`count(*) filter (where ${users.isActive} and not ${hasLoginRoute})`.mapWith(Number),
      inactive: sql<number>`count(*) filter (where not ${users.isActive})`.mapWith(Number),
    }).from(users),
    db.select({
      total: count(),
      live: sql<number>`count(*) filter (where ${apps.isActive} and ${apps.status} = 'active')`.mapWith(Number),
      testing: sql<number>`count(*) filter (where ${apps.isActive} and ${apps.status} = 'testing')`.mapWith(Number),
      unavailable: sql<number>`count(*) filter (where ${apps.isActive} and ${apps.status} = 'unavailable')`.mapWith(Number),
      hidden: sql<number>`count(*) filter (where not ${apps.isActive})`.mapWith(Number),
    }).from(apps),
    db.select({ branchesN: count() }).from(branches),
    db.select({ teamsN: count() }).from(teams),
  ]);
  return { users: u, apps: a, branches: branchesN, teams: teamsN };
}
