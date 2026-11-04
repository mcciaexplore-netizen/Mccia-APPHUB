import "server-only";
import { cache } from "react";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db, rowsOf } from "./db";
import { departments, users, type User } from "@/db/schema";
import { getCurrentUser as hostCurrentUser } from "@/lib/permissions";
import { notifyUsers } from "@/lib/notifications";
import { escapeHtml, sendMail as hostSendMail, type MailResult } from "@/lib/mail";
import { siteUrl as hostSiteUrl } from "@/lib/site-url";
import { logError as hostLogError } from "@/lib/log-error";
import { noticeUnread } from "@/lib/notice-feed";
import { AISTUDIO_ADMIN_URL_PATTERN, AISTUDIO_USER_URL_PATTERN, aiRolesFor, type AiRole } from "./aistudio.manifest";

/**
 * The only file in the AI Studio module that knows about the host: its session, its users, departments, application access (grants, App
 * Admins, App Staff), the bell, email, the site's address and its error log. Everything else asks here, as in the other modules.
 */

export type { AiRole };
export type AiUser = { id: string; name: string; email: string; roles: AiRole[]; hubRole: User["role"]; department: string | null };
export type Access = { status: "anonymous" } | { status: "ok"; user: AiUser };
export type Person = { id: string; name: string; email: string };

/** Active, approved hub users given the application at this URL. */
const appHolders = (pattern: string) => sql`select ua.user_id from user_app_access ua
  join apps a on a.id = ua.app_id
  join departments d on d.id = a.department_id
  join users u on u.id = ua.user_id
  where a.is_active and d.is_active and a.status <> 'unavailable' and a.url ~ ${pattern} and u.is_active and u.status = 'approved'`;

/** One query: whether the person has AI Studio and AI Studio Admin, and whether they are one of its App Admins or App Staff. */
async function standing(userId: string): Promise<{ userAccess: boolean; adminAccess: boolean; adminAppAdmin: boolean; adminAppStaff: boolean }> {
  const res = await db.execute(sql`
    select coalesce(bool_or(a.url ~ ${AISTUDIO_USER_URL_PATTERN} and ua.user_id is not null), false) as user_access,
      coalesce(bool_or(a.url ~ ${AISTUDIO_ADMIN_URL_PATTERN} and ua.user_id is not null), false) as admin_access,
      coalesce(bool_or(a.url ~ ${AISTUDIO_ADMIN_URL_PATTERN} and aa.user_id is not null), false) as admin_app_admin,
      coalesce(bool_or(a.url ~ ${AISTUDIO_ADMIN_URL_PATTERN} and st.user_id is not null), false) as admin_app_staff
    from apps a
    join departments d on d.id = a.department_id
    left join user_app_access ua on ua.app_id = a.id and ua.user_id = ${userId}
    left join app_admins aa on aa.app_id = a.id and aa.user_id = ${userId}
    left join app_staff st on st.app_id = a.id and st.user_id = ${userId}
    where a.is_active and d.is_active and a.status <> 'unavailable' and (a.url ~ ${AISTUDIO_USER_URL_PATTERN} or a.url ~ ${AISTUDIO_ADMIN_URL_PATTERN})`);
  const r = rowsOf<{ user_access: boolean; admin_access: boolean; admin_app_admin: boolean; admin_app_staff: boolean }>(res)[0];
  return { userAccess: !!r?.user_access, adminAccess: !!r?.admin_access, adminAppAdmin: !!r?.admin_app_admin, adminAppStaff: !!r?.admin_app_staff };
}

async function departmentName(id: string | null): Promise<string | null> {
  if (!id) return null;
  const [d] = await db.select({ name: departments.name }).from(departments).where(eq(departments.id, id)).limit(1);
  return d?.name ?? null;
}

/** Who is asking and their roles here (see aistudio.manifest.ts). Any signed-in hub user is "ok", with or without roles. */
export const resolveAccess = cache(async (): Promise<Access> => {
  const host = await hostCurrentUser();
  if (!host) return { status: "anonymous" };
  const [s, department] = await Promise.all([standing(host.id), departmentName(host.homeDepartmentId)]);
  const roles = aiRolesFor({ hubRole: host.role, ...s });
  return { status: "ok", user: { id: host.id, name: host.name, email: host.email, roles, hubRole: host.role, department } };
});

/** Whether the person is still on the temporary password they were emailed. */
export const needsOwnPassword = async () => !!(await hostCurrentUser())?.mustChangePassword;

const inList = (table: "app_admins" | "app_staff") =>
  sql`select x.user_id from ${sql.raw(table)} x join apps a on a.id = x.app_id where a.url ~ ${AISTUDIO_ADMIN_URL_PATTERN}`;

/** The leads: App Admins of AI Studio Admin who also hold it. With none, the Support Admins stand in, so no request goes unnoticed. */
export async function listLeads(): Promise<Person[]> {
  const leads = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(sql`${users.id} in (${appHolders(AISTUDIO_ADMIN_URL_PATTERN)}) and ${users.id} in (${inList("app_admins")})`)
    .orderBy(asc(users.name));
  if (leads.length) return leads;
  return db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(and(eq(users.role, "head_admin"), eq(users.isActive, true), eq(users.status, "approved")));
}

/** Who a request may be assigned to: the AI Studio team (its App Staff and App Admins who hold AI Studio Admin), by name. */
export async function listTeam(): Promise<Person[]> {
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(sql`${users.id} in (${appHolders(AISTUDIO_ADMIN_URL_PATTERN)}) and (${users.id} in (${inList("app_staff")}) or ${users.id} in (${inList("app_admins")}))`)
    .orderBy(asc(users.name));
}

/** For searching requests by who asked: the ids of hub users whose name matches an ILIKE pattern, as a subquery. */
export const peopleNamedLike = (pattern: string) => sql`select ${users.id} from ${users} where ${users.name} ilike ${pattern}`;

/** For sorting requests by a person's name: the hub name of the user whose id is in `column`, as a subquery. */
export const userNameOf = (column: SQL) => sql`(select ${users.name} from ${users} where ${users.id} = ${column})`;

/** These hub users (active or not), by id. */
export async function peopleByIds(ids: (string | null | undefined)[]): Promise<Map<string, Person>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  if (!want.length) return new Map();
  const rows = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, want));
  return new Map(rows.map((r) => [r.id, r]));
}

/** The organisation departments people belong to, for the request form's department list. */
export async function listDepartmentNames(): Promise<string[]> {
  const rows = await db
    .select({ name: departments.name })
    .from(departments)
    .where(and(eq(departments.kind, "organisation"), eq(departments.isActive, true)))
    .orderBy(asc(departments.name));
  return rows.map((r) => r.name);
}

/** The hub bell. Never throws. `link` is a page of this site. */
export async function notify(notices: { userId: string; title: string; body?: string; link?: string; key: string }[]): Promise<void> {
  try {
    await notifyUsers(notices.map((n) => ({ userId: n.userId, kind: "aistudio", title: n.title, body: n.body ?? null, link: n.link ?? null, dedupeKey: `aistudio:${n.key}` })));
  } catch {
    // a notice that cannot be sent must not undo the change behind it
  }
}

/** Email through the hub's SMTP settings. Plain text is turned into simple HTML. Never throws. */
export async function sendMail(to: string, subject: string, text: string): Promise<MailResult> {
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#0f172a">${text
    .split("\n")
    .map((line) => (/^https?:\/\//.test(line.trim()) ? `<a href="${escapeHtml(line.trim())}">${escapeHtml(line.trim())}</a>` : escapeHtml(line)))
    .join("<br>")}</div>`;
  try {
    return await hostSendMail(to, subject, html);
  } catch {
    return "failed";
  }
}

/** How many unread notices the person has (for the hub's bell in the page frame). */
export const unreadNotices = (userId: string) => noticeUnread(userId);

/** This site's address, for links in emails. */
export const siteUrl = () => hostSiteUrl();

/** The hub's error log (server only). */
export const logError = (message: string, e: unknown) => hostLogError(message, e);
