import "server-only";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { apps, userAppAccess, users, type User } from "@/db/schema";
import { notifyUsers } from "@/lib/notifications";
import { writeAudit, type AuditEntry } from "@/lib/audit";
import { canGrantAny, canManageAccess, firstUngrantable, grantableApps, isSuper } from "@/lib/rbac";
import type { SsoRole } from "@/lib/sso-rules";
import { UserError } from "@/lib/user-error";
import { logError } from "@/lib/log-error";

/**
 * Giving and taking away application access, for many people and many applications at once.
 *
 * Every change is ONE database statement (rows are added and removed together, or not at all), so a failure can never leave a person
 * half-changed and a retry is safe: adding what is already there, or removing what is already gone, does nothing. Who may be changed and
 * which applications may be handed out is decided by src/lib/rbac.ts before anything is written, and every change is recorded in the
 * audit log with what was added and removed.
 */

export type AccessMode = "add" | "remove" | "replace";
export type AccessRequest = { userIds: string[]; appIds: string[]; mode: AccessMode; source: string };
type NamedApp = { id: string; name: string };
type AccessChange = { userId: string; name: string; added: NamedApp[]; removed: NamedApp[]; after: NamedApp[] };
export type AccessResult = { users: number; changed: AccessChange[]; unchanged: number };
export type AccessPreviewRow = { userId: string; name: string; email: string; willAdd: NamedApp[]; willRemove: NamedApp[]; keeps: number };

export const MAX_PEOPLE = 5000;

type Row = { user_id: string; app_id: string; k?: string };
const list = (ids: readonly string[]): SQL => sql.join(ids.map((i) => sql`${i}`), sql`, `);
async function run(q: SQL): Promise<Row[]> {
  return ((await db.execute(q)) as unknown as { rows: Row[] }).rows;
}

type Actor = Pick<User, "id" | "name" | "role" | "teamId">;

async function ownApps(actor: Actor): Promise<Set<string>> {
  const rows = await db.select({ appId: userAppAccess.appId }).from(userAppAccess).where(eq(userAppAccess.userId, actor.id));
  return new Set(rows.map((r) => r.appId));
}

/** Loads and checks everything a request refers to. Throws a plain-language error for the first thing that is not allowed. */
async function context(actor: Actor, req: AccessRequest) {
  const userIds = [...new Set(req.userIds)];
  const appIds = [...new Set(req.appIds)];
  if (userIds.length === 0) throw new UserError("Select at least one user.");
  if (userIds.length > MAX_PEOPLE) throw new UserError(`Choose at most ${MAX_PEOPLE} people at a time.`);
  if (appIds.length === 0 && req.mode !== "replace") throw new UserError("Select at least one application.");

  const [targets, catalog] = await Promise.all([
    db.select({ id: users.id, name: users.name, email: users.email, role: users.role, teamId: users.teamId, reportingManagerId: users.reportingManagerId }).from(users).where(inArray(users.id, userIds)),
    db.select({ id: apps.id, name: apps.name }).from(apps),
  ]);
  if (targets.length !== userIds.length) throw new UserError("One or more users no longer exist. Reload and try again.");
  const names = new Map(catalog.map((a) => [a.id, a.name]));
  if (appIds.some((id) => !names.has(id))) throw new UserError("One or more applications no longer exist. Reload and try again.");

  for (const t of targets) {
    if (!canManageAccess(actor, t)) throw new UserError(`You are not allowed to change access for ${t.name}.`);
  }
  const grantable = grantableApps(actor, canGrantAny(actor) ? new Set() : await ownApps(actor));
  if (firstUngrantable(grantable, appIds)) throw new UserError("You can only give or take away applications that you can open yourself.");
  return { userIds, appIds, targets, names, grantable, appName: (id: string): NamedApp => ({ id, name: names.get(id) ?? "Deleted application" }) };
}

/** What a request would do, without doing it: for the review step before confirming. */
export async function previewAccess(actor: Actor, req: AccessRequest): Promise<{ rows: AccessPreviewRow[]; adds: number; removes: number; unchanged: number }> {
  const c = await context(actor, req);
  const have = await db.select({ userId: userAppAccess.userId, appId: userAppAccess.appId }).from(userAppAccess).where(inArray(userAppAccess.userId, c.userIds));
  const current = new Map<string, Set<string>>();
  for (const h of have) (current.get(h.userId) ?? current.set(h.userId, new Set()).get(h.userId)!).add(h.appId);
  const want = new Set(c.appIds);

  const rows = c.targets.map((t): AccessPreviewRow => {
    const has = current.get(t.id) ?? new Set<string>();
    let add: string[] = [], remove: string[] = [];
    if (req.mode === "add") add = c.appIds.filter((id) => !has.has(id));
    else if (req.mode === "remove") remove = c.appIds.filter((id) => has.has(id));
    else {
      add = c.appIds.filter((id) => !has.has(id));
      remove = [...has].filter((id) => !want.has(id) && (c.grantable === null || c.grantable.has(id)));
    }
    return { userId: t.id, name: t.name, email: t.email, willAdd: add.map(c.appName), willRemove: remove.map(c.appName), keeps: has.size - remove.length };
  });
  const changed = rows.filter((r) => r.willAdd.length + r.willRemove.length > 0);
  return { rows: rows.sort((a, b) => a.name.localeCompare(b.name)), adds: rows.reduce((n, r) => n + r.willAdd.length, 0), removes: rows.reduce((n, r) => n + r.willRemove.length, 0), unchanged: rows.length - changed.length };
}

/** Makes the change. All of it is saved or none of it is; the result says exactly who got what. */
export async function applyAccess(actor: Actor, req: AccessRequest): Promise<AccessResult> {
  const c = await context(actor, req);
  const U = list(c.userIds);
  const insert = (W: SQL) => sql`insert into user_app_access (user_id, app_id, granted_by_id)
    select u.id, a.id, ${actor.id}::uuid from users u cross join apps a where u.id in (${U}) and a.id in (${W})
    on conflict (user_id, app_id) do nothing returning user_id, app_id`;

  let rows: Row[];
  if (req.mode === "add") {
    rows = (await run(insert(list(c.appIds)))).map((r) => ({ ...r, k: "added" }));
  } else if (req.mode === "remove") {
    rows = (await run(sql`delete from user_app_access where user_id in (${U}) and app_id in (${list(c.appIds)}) returning user_id, app_id`)).map((r) => ({ ...r, k: "removed" }));
  } else {
    const scope = c.grantable === null ? sql`` : c.grantable.size === 0 ? sql`and false` : sql`and app_id in (${list([...c.grantable])})`;
    const keep = c.appIds.length ? sql`and app_id not in (${list(c.appIds)})` : sql``;
    const del = sql`del as (delete from user_app_access where user_id in (${U}) ${scope} ${keep} returning user_id, app_id)`;
    rows = c.appIds.length
      ? await run(sql`with ${del}, ins as (${insert(list(c.appIds))})
          select 'removed' as k, user_id, app_id from del union all select 'added' as k, user_id, app_id from ins`)
      : await run(sql`with ${del} select 'removed' as k, user_id, app_id from del`);
  }

  return settle(actor, { userIds: c.userIds, targets: c.targets, appName: c.appName }, rows, req.source, req.mode);
}

type SettleCtx = { userIds: string[]; targets: { id: string; name: string }[]; appName: (id: string) => NamedApp };

/** Turns the rows a statement changed into a per-person result and writes the audit entries. */
async function settle(actor: Actor, c: SettleCtx, rows: Row[], source: string, mode: string): Promise<AccessResult> {
  const by = new Map<string, { added: string[]; removed: string[] }>();
  for (const r of rows) {
    const e = by.get(r.user_id) ?? { added: [], removed: [] };
    (r.k === "added" ? e.added : e.removed).push(r.app_id);
    by.set(r.user_id, e);
  }
  const changedIds = [...by.keys()];
  const after = new Map<string, string[]>();
  if (changedIds.length) {
    for (const g of await db.select({ userId: userAppAccess.userId, appId: userAppAccess.appId }).from(userAppAccess).where(inArray(userAppAccess.userId, changedIds))) {
      (after.get(g.userId) ?? after.set(g.userId, []).get(g.userId)!).push(g.appId);
    }
  }
  const nameOf = new Map(c.targets.map((t) => [t.id, t.name]));
  const changed: AccessChange[] = changedIds.map((id) => {
    const e = by.get(id)!;
    return { userId: id, name: nameOf.get(id) ?? "", added: e.added.map(c.appName), removed: e.removed.map(c.appName), after: (after.get(id) ?? []).map(c.appName) };
  });

  const entries: AuditEntry[] = changed.map((ch) => {
    const addedIds = new Set(ch.added.map((a) => a.id));
    const before = [...ch.after.filter((a) => !addedIds.has(a.id)), ...ch.removed].map((a) => a.name).sort();
    return {
      action: "access.change", targetType: "user", targetId: ch.userId, targetLabel: ch.name,
      details: { source: source, mode: mode, added: ch.added.map((a) => a.name), removed: ch.removed.map((a) => a.name), before, after: ch.after.map((a) => a.name).sort() },
    };
  });
  try {
    await writeAudit(actor, entries);
  } catch (e) {
    logError("[hub] access: audit write failed", e);
    throw new UserError("The access was changed, but the change could not be recorded in the audit log. Please tell an administrator.");
  }
  // Tell each person whose access changed. The key makes the same change written twice (a retry) a single notification.
  const minute = Math.floor(Date.now() / 60000);
  await notifyUsers(changed.map((ch) => ({
    userId: ch.userId, kind: ch.added.length && !ch.removed.length ? "access_granted" : ch.removed.length && !ch.added.length ? "access_revoked" : "access_changed",
    title: ch.added.length && !ch.removed.length ? "You were given access to an application" : ch.removed.length && !ch.added.length ? "Your access to an application was removed" : "Your application access changed",
    body: [ch.added.length ? `Added: ${ch.added.map((a) => a.name).join(", ")}.` : "", ch.removed.length ? `Removed: ${ch.removed.map((a) => a.name).join(", ")}.` : ""].filter(Boolean).join(" "),
    link: "/",
    dedupeKey: `access:${[...ch.added.map((a) => a.id)].sort().join(",")}|${[...ch.removed.map((a) => a.id)].sort().join(",")}:${minute}`,
  })));
  return { users: c.userIds.length, changed, unchanged: c.userIds.length - changed.length };
}


export type AppUsersRequest = { appId: string; add: string[]; remove: string[]; source: string };

/**
 * The per-application screen: add some people and remove others in one go, in ONE statement (all of it or none of it).
 * A team manager may only use it for an application they can open, and only for people in their scope.
 */
export async function applyAppUserChange(actor: Actor, req: AppUsersRequest): Promise<AccessResult> {
  const add = [...new Set(req.add)].filter((id) => !req.remove.includes(id));
  const remove = [...new Set(req.remove)];
  const everyone = [...new Set([...add, ...remove])];
  if (everyone.length === 0) throw new UserError("Choose at least one person to add or remove.");
  if (everyone.length > MAX_PEOPLE) throw new UserError(`Choose at most ${MAX_PEOPLE} people at a time.`);
  const [targets, catalog] = await Promise.all([
    db.select({ id: users.id, name: users.name, role: users.role, teamId: users.teamId, reportingManagerId: users.reportingManagerId }).from(users).where(inArray(users.id, everyone)),
    db.select({ id: apps.id, name: apps.name }).from(apps),
  ]);
  const names = new Map(catalog.map((a) => [a.id, a.name]));
  const app = names.has(req.appId) ? { id: req.appId, name: names.get(req.appId)! } : null;
  if (!app) throw new UserError("That application no longer exists. Reload and try again.");
  if (targets.length !== everyone.length) throw new UserError("One or more users no longer exist. Reload and try again.");
  for (const t of targets) if (!canManageAccess(actor, t)) throw new UserError(`You are not allowed to change access for ${t.name}.`);
  if (firstUngrantable(grantableApps(actor, canGrantAny(actor) ? new Set() : await ownApps(actor)), [app.id])) throw new UserError("You can only give or take away applications that you can open yourself.");

  const A = sql`${app.id}`;
  const del = remove.length ? sql`del as (delete from user_app_access where app_id = ${A} and user_id in (${list(remove)}) returning user_id, app_id)` : null;
  const ins = add.length
    ? sql`ins as (insert into user_app_access (user_id, app_id, granted_by_id) select u.id, a.id, ${actor.id}::uuid from users u cross join apps a where u.id in (${list(add)}) and a.id = ${A} on conflict (user_id, app_id) do nothing returning user_id, app_id)`
    : null;
  const parts = [del, ins].filter((x): x is SQL => x !== null);
  const pick = [del && sql`select 'removed' as k, user_id, app_id from del`, ins && sql`select 'added' as k, user_id, app_id from ins`].filter((x): x is SQL => x !== null);
  const rows = await run(sql`with ${sql.join(parts, sql`, `)} ${sql.join(pick, sql` union all `)}`);
  return settle(actor, { userIds: everyone, targets, appName: (id) => ({ id, name: names.get(id) ?? "Deleted application" }) }, rows, req.source, "app");
}


/**
 * Sets a person's role inside a single sign-on application ("user", "admin" or "super_admin"; it is what the token says about them). Only the Support Admin
 * may do this, and the person must already have the application (a role belongs to the grant). Re-granting access keeps the role: the
 * grant statements above do nothing when the grant is already there. Audited as access.role.
 */
export async function applyAppUserRole(actor: Pick<User, "id" | "name" | "role">, req: { appId: string; userId: string; role: SsoRole }): Promise<{ changed: boolean }> {
  if (!isSuper(actor)) throw new UserError("Only the Support Admin can change a person's role in an application.");
  const [[app], [person], [grant]] = await Promise.all([
    db.select({ name: apps.name }).from(apps).where(eq(apps.id, req.appId)),
    db.select({ name: users.name }).from(users).where(eq(users.id, req.userId)),
    db.select({ role: userAppAccess.appRole }).from(userAppAccess).where(and(eq(userAppAccess.appId, req.appId), eq(userAppAccess.userId, req.userId))),
  ]);
  if (!app) throw new UserError("That application no longer exists. Reload and try again.");
  if (!person) throw new UserError("That user no longer exists. Reload and try again.");
  if (!grant) throw new UserError(`${person.name} does not have access to ${app.name}. Give them access first.`);
  if (grant.role === req.role) return { changed: false };
  await db.update(userAppAccess).set({ appRole: req.role }).where(and(eq(userAppAccess.appId, req.appId), eq(userAppAccess.userId, req.userId)));
  try {
    await writeAudit(actor, [{ action: "access.role", targetType: "user", targetId: req.userId, targetLabel: person.name, details: { application: app.name, from: grant.role, to: req.role } }]);
  } catch (e) {
    logError("[hub] access: audit write failed", e);
    throw new UserError("The role was changed, but the change could not be recorded in the audit log. Please tell an administrator.");
  }
  return { changed: true };
}

/**
 * Sets every role in one single sign-on application at once, from the Edit form's App roles: the people listed as admins and super admins
 * get that role, everyone else who has the application becomes a user. Only the Support Admin, only people who already have the application,
 * and nobody in both lists. One statement changes only the rows whose role really changes; each change is audited as access.role.
 */
export async function applyAppRoles(actor: Pick<User, "id" | "name" | "role">, req: { appId: string; admins: string[]; superAdmins: string[] }): Promise<{ changed: number }> {
  if (!isSuper(actor)) throw new UserError("Only the Support Admin can change people's roles in an application.");
  const admins = new Set(req.admins);
  const superAdmins = new Set(req.superAdmins);
  if (req.admins.some((id) => superAdmins.has(id))) throw new UserError("A person can be an Admin or a Super Admin, not both.");
  const [[app], grants] = await Promise.all([
    db.select({ name: apps.name, sso: apps.ssoEnabled }).from(apps).where(eq(apps.id, req.appId)),
    db.select({ userId: userAppAccess.userId, role: userAppAccess.appRole, name: users.name }).from(userAppAccess)
      .innerJoin(users, eq(users.id, userAppAccess.userId)).where(eq(userAppAccess.appId, req.appId)),
  ]);
  if (!app) throw new UserError("That application no longer exists. Reload and try again.");
  if (!app.sso) throw new UserError("Roles only apply to an application with single sign-on.");
  const granted = new Set(grants.map((g) => g.userId));
  if ([...admins, ...superAdmins].some((id) => !granted.has(id))) throw new UserError("Everyone given a role must already have this application. Reload and try again.");

  const want = (id: string): SsoRole => (superAdmins.has(id) ? "super_admin" : admins.has(id) ? "admin" : "user");
  const changes = grants.filter((g) => g.role !== want(g.userId));
  if (changes.length === 0) return { changed: 0 };
  const among = (ids: Set<string>) => (ids.size ? sql`${userAppAccess.userId} in (${list([...ids])})` : sql`false`);
  const role = sql`case when ${among(superAdmins)} then 'super_admin' when ${among(admins)} then 'admin' else 'user' end`;
  await db.update(userAppAccess).set({ appRole: role })
    .where(and(eq(userAppAccess.appId, req.appId), inArray(userAppAccess.userId, changes.map((c) => c.userId))));
  try {
    await writeAudit(actor, changes.map((c) => ({ action: "access.role", targetType: "user", targetId: c.userId, targetLabel: c.name, details: { application: app.name, from: c.role, to: want(c.userId) } })));
  } catch (e) {
    logError("[hub] access: audit write failed", e);
    throw new UserError("The roles were changed, but the change could not be recorded in the audit log. Please tell an administrator.");
  }
  return { changed: changes.length };
}
