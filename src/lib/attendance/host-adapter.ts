import "server-only";
import { cache } from "react";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { db, rowsOf } from "./db";
import { users, type User } from "@/db/schema";
import { getCurrentUser as hostCurrentUser } from "@/lib/permissions";
import { notifyUsers } from "@/lib/notifications";
import { logError as hostLogError } from "@/lib/log-error";
import { noticeUnread } from "@/lib/notice-feed";
import { writeAudit } from "@/lib/audit";
import { escapeHtml, sendMail } from "@/lib/mail";
import { siteUrl } from "@/lib/site-url";
import { wouldCreateCycle } from "@/lib/rbac";
import { clientIp } from "@/lib/ip";
import { headers } from "next/headers";
import { ATT_ADMIN_URL_PATTERN, ATT_USER_URL_PATTERN, attRolesFor, type AttRole } from "./att.manifest";

/**
 * The only file in the Attendance module that knows about the host: its session, its users (name, team, branch, reporting manager),
 * application access, the bell, email, its error log and its access audit. Everything else asks here, as in the other modules.
 *
 * Members are everyone holding the Attendance tile (/attendance); HR are the App Admins of Attendance Admin (/attendance/admin). A person's
 * reporting manager is the hub's users.reporting_manager_id: HR change it from People here, through setManager(), which applies the hub's
 * own cycle rule and records the change in the hub's access audit, so Administrator and Attendance always agree.
 */

export type AttUser = { id: string; name: string; email: string; roles: AttRole[]; hubRole: User["role"] };
export type Access = { status: "anonymous" } | { status: "ok"; user: AttUser };
export type Person = { id: string; name: string; email: string };
export type Member = Person & {
  designation: string | null;
  managerId: string | null;
  teamId: string | null;
  teamName: string | null;
  branchId: string | null;
  branchName: string | null;
};

/** One query: whether the person holds Attendance, and whether they are an App Admin of Attendance Admin. */
async function standing(userId: string): Promise<{ access: boolean; adminAppAdmin: boolean }> {
  const res = await db.execute(sql`
    select coalesce(bool_or(a.url ~ ${ATT_USER_URL_PATTERN} and ua.user_id is not null), false) as access,
      coalesce(bool_or(a.url ~ ${ATT_ADMIN_URL_PATTERN} and aa.user_id is not null), false) as admin_app_admin
    from apps a
    join departments d on d.id = a.department_id
    left join user_app_access ua on ua.app_id = a.id and ua.user_id = ${userId}
    left join app_admins aa on aa.app_id = a.id and aa.user_id = ${userId}
    where a.is_active and d.is_active and a.status <> 'unavailable' and (a.url ~ ${ATT_USER_URL_PATTERN} or a.url ~ ${ATT_ADMIN_URL_PATTERN})`);
  const r = rowsOf<{ access: boolean; admin_app_admin: boolean }>(res)[0];
  return { access: !!r?.access, adminAppAdmin: !!r?.admin_app_admin };
}

/** Who is asking and their roles here (see att.manifest.ts). Any signed-in hub user is "ok", with or without roles. */
export const resolveAccess = cache(async (): Promise<Access> => {
  const host = await hostCurrentUser();
  if (!host) return { status: "anonymous" };
  const s = await standing(host.id);
  const roles = attRolesFor({ hubRole: host.role, ...s });
  return { status: "ok", user: { id: host.id, name: host.name, email: host.email, roles, hubRole: host.role } };
});

/** Whether the person is still on the temporary password they were emailed. */
export const needsOwnPassword = async () => !!(await hostCurrentUser())?.mustChangePassword;

/** The two applications, as added in Administrator → Applications (the first active one of each). */
async function attApps(): Promise<{ user: string | null; admin: string | null }> {
  const res = await db.execute(sql`
    select a.id, a.url from apps a join departments d on d.id = a.department_id
    where a.is_active and d.is_active and (a.url ~ ${ATT_USER_URL_PATTERN} or a.url ~ ${ATT_ADMIN_URL_PATTERN})
    order by a.created_at`);
  const rows = rowsOf<{ id: string; url: string }>(res);
  return {
    user: rows.find((r) => new RegExp(ATT_USER_URL_PATTERN).test(r.url))?.id ?? null,
    admin: rows.find((r) => new RegExp(ATT_ADMIN_URL_PATTERN).test(r.url))?.id ?? null,
  };
}

/** Whether both applications are set up, for Settings. */
export async function appsSetUp(): Promise<{ user: boolean; admin: boolean }> {
  const a = await attApps();
  return { user: !!a.user, admin: !!a.admin };
}

type MemberRow = { id: string; name: string; email: string; designation: string | null; manager_id: string | null; team_id: string | null; team_name: string | null; branch_id: string | null; branch_name: string | null };
const toMember = (r: MemberRow): Member => ({
  id: r.id,
  name: r.name,
  email: r.email,
  designation: r.designation,
  managerId: r.manager_id,
  teamId: r.team_id,
  teamName: r.team_name,
  branchId: r.branch_id,
  branchName: r.branch_name,
});

/**
 * Everyone Attendance covers: active, approved hub users who hold the Attendance tile or are HR, by name. Cached per request (every page
 * that shows people uses it).
 */
export const listMembers = cache(async (): Promise<Member[]> => {
  const apps = await attApps();
  if (!apps.user && !apps.admin) return [];
  const res = await db.execute(sql`
    select u.id, u.name, u.email, u.designation, u.reporting_manager_id as manager_id, t.id as team_id, t.name as team_name,
      coalesce(b.id, tb.id) as branch_id, coalesce(b.name, tb.name) as branch_name
    from users u
    left join teams t on t.id = u.team_id
    left join branches b on b.id = u.branch_id
    left join branches tb on tb.id = t.branch_id
    where u.is_active and u.status = 'approved' and (
      exists (select 1 from user_app_access ua where ua.user_id = u.id and ua.app_id = ${apps.user ?? sql`null`})
      or exists (select 1 from app_admins aa where aa.user_id = u.id and aa.app_id = ${apps.admin ?? sql`null`}))
    order by u.name`);
  return rowsOf<MemberRow>(res).map(toMember);
});

/** HR: the active App Admins of Attendance Admin. With none, the Support Admin(s), so a request is never sent to nobody. */
export async function hrIds(): Promise<string[]> {
  const apps = await attApps();
  if (apps.admin) {
    const res = await db.execute(sql`
      select u.id from app_admins aa join users u on u.id = aa.user_id
      where aa.app_id = ${apps.admin} and u.is_active and u.status = 'approved'`);
    const ids = rowsOf<{ id: string }>(res).map((r) => r.id);
    if (ids.length) return ids;
  }
  const heads = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "head_admin"), eq(users.isActive, true)));
  return heads.map((h) => h.id);
}

/** A hub user's name, email, manager and whether they are active, by id. */
export async function personFacts(id: string): Promise<(Person & { managerId: string | null; active: boolean }) | null> {
  const [u] = await db
    .select({ id: users.id, name: users.name, email: users.email, managerId: users.reportingManagerId, isActive: users.isActive, status: users.status })
    .from(users)
    .where(eq(users.id, id));
  return u ? { id: u.id, name: u.name, email: u.email, managerId: u.managerId, active: u.isActive && u.status === "approved" } : null;
}

/** These hub users (active or not), by id. */
export async function peopleByIds(ids: (string | null | undefined)[]): Promise<Map<string, Person>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map();
  const rows = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, want));
  return new Map(rows.map((r) => [r.id, r]));
}

/** Active, approved hub users whose name or email matches (at most 15), for CC and manager pickers. */
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

/** Active teams and branches, for the Today filters. */
export async function teamsAndBranches(): Promise<{ teams: { id: string; name: string }[]; branches: { id: string; name: string }[] }> {
  const [t, b] = await Promise.all([
    db.execute(sql`select id, name from teams where is_active order by name`),
    db.execute(sql`select id, name from branches where is_active order by name`),
  ]);
  return { teams: rowsOf<{ id: string; name: string }>(t), branches: rowsOf<{ id: string; name: string }>(b) };
}

/** A problem HR can fix (shown as is). */
export class HostError extends Error {}

/**
 * Sets a person's reporting manager in the hub (null clears it). Refuses a manager who is inactive or would make a loop (someone above
 * themself), as the hub's own profile editor does, and records the change in the hub's access audit.
 */
export async function setManager(actor: { id: string; name: string }, userId: string, managerId: string | null): Promise<{ name: string }> {
  const person = await personFacts(userId);
  if (!person?.active) throw new HostError("That person is no longer an active hub user. Reload and try again.");
  if (managerId === userId) throw new HostError("Someone cannot report to themself.");
  if (managerId) {
    const m = await personFacts(managerId);
    if (!m?.active) throw new HostError("That manager is not an active hub user.");
    const all = await db.select({ id: users.id, managerId: users.reportingManagerId }).from(users);
    const managerOf = new Map(all.map((r) => [r.id, r.managerId]));
    if (wouldCreateCycle(userId, managerId, (id) => managerOf.get(id))) throw new HostError(`${m.name} reports (directly or not) to ${person.name}, so cannot be their manager.`);
  }
  if (person.managerId === managerId) return { name: person.name };
  await db.update(users).set({ reportingManagerId: managerId }).where(eq(users.id, userId));
  await writeAudit(actor, [{ action: "attendance.manager", targetType: "user", targetId: userId, targetLabel: person.name, details: { from: person.managerId, to: managerId } }]);
  return { name: person.name };
}

// ── The rest of the host ───────────────────────────────────────────────────

/** The hub bell. Never throws. `link` is a page of this site; `key` makes the same event a single notice. */
export async function notify(notices: { userId: string; title: string; body?: string; link?: string; key: string }[]): Promise<void> {
  if (!notices.length) return;
  try {
    await notifyUsers(notices.map((n) => ({ userId: n.userId, kind: "attendance", title: n.title, body: n.body ?? null, link: n.link ?? null, dedupeKey: `att:${n.key}` })));
  } catch {
    // a notice that cannot be sent must not undo the change behind it
  }
}

/** An email (only when Settings → email is on). Never throws. */
export async function email(to: string[], subject: string, lines: string[], link?: string): Promise<void> {
  if (!to.length) return;
  const url = link ? `${siteUrl().replace(/\/+$/, "")}${link}` : null;
  const html = `${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("")}${url ? `<p><a href="${escapeHtml(url)}">Open in the App Hub</a></p>` : ""}`;
  for (const addr of to) {
    try {
      await sendMail(addr, subject, html);
    } catch {
      // email is a courtesy; the bell already has it
    }
  }
}

/** The address the current request came from (set by Vercel, so the visitor cannot choose it). */
export const requestIp = async () => clientIp(await headers());

/** For the debug-ip route: the address used, and the raw headers it can come from (Vercel sets all three; the first one present wins). */
export async function requestIpDetails(): Promise<{ ip: string | null; headers: Record<string, string | null> }> {
  const h = await headers();
  return { ip: clientIp(h), headers: { "x-vercel-forwarded-for": h.get("x-vercel-forwarded-for"), "x-real-ip": h.get("x-real-ip"), "x-forwarded-for": h.get("x-forwarded-for") } };
}

/** How many unread notices the person has (for the hub's bell in the page frame). */
export const unreadNotices = (userId: string) => noticeUnread(userId);

/** The hub's error log (server only). */
export const logError = (message: string, e: unknown) => hostLogError(message, e);
