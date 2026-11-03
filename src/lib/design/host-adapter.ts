import "server-only";
import { cache } from "react";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, rowsOf } from "./db";
import { departments, users, type User } from "@/db/schema";
import { getCurrentUser as hostCurrentUser } from "@/lib/permissions";
import { notifyUsers } from "@/lib/notifications";
import { escapeHtml, sendMail as hostSendMail, type MailResult } from "@/lib/mail";
import { siteUrl as hostSiteUrl } from "@/lib/site-url";
import { DESIGN_ADMIN_URL_PATTERN, DESIGN_TEAM_URL_PATTERN, designRolesFor, type DesignRole } from "./design.manifest";

/**
 * The only file in the DesignDesk module that knows about the host: its session, its users, departments, application access,
 * notifications, email and address. Everything else asks here, the same way Cab Booking and IVR-CRM do.
 */

export type { DesignRole };
export type DesignUser = { id: string; name: string; email: string; roles: DesignRole[]; hubRole: User["role"]; department: string | null };
export type Access = { status: "anonymous" } | { status: "ok"; user: DesignUser };
export type Person = { id: string; name: string; email: string };

const appHolders = (pattern: string) => sql`select ua.user_id from user_app_access ua
  join apps a on a.id = ua.app_id
  join departments d on d.id = a.department_id
  join users u on u.id = ua.user_id
  where a.is_active and d.is_active and a.status <> 'unavailable' and a.url ~ ${pattern} and u.is_active and u.status = 'approved'`;

/**
 * One query: whether the person has been given Design Team Forms (URL /design) and Design Admin (URL /design/admin), and whether they are
 * one of Design Admin's App Admins (the leads).
 */
async function standing(userId: string): Promise<{ teamAccess: boolean; adminAccess: boolean; adminAppAdmin: boolean }> {
  const res = await db.execute(sql`
    select coalesce(bool_or(a.url ~ ${DESIGN_TEAM_URL_PATTERN} and ua.user_id is not null), false) as team_access,
      coalesce(bool_or(a.url ~ ${DESIGN_ADMIN_URL_PATTERN} and ua.user_id is not null), false) as admin_access,
      coalesce(bool_or(a.url ~ ${DESIGN_ADMIN_URL_PATTERN} and aa.user_id is not null), false) as admin_app_admin
    from apps a
    join departments d on d.id = a.department_id
    left join user_app_access ua on ua.app_id = a.id and ua.user_id = ${userId}
    left join app_admins aa on aa.app_id = a.id and aa.user_id = ${userId}
    where a.is_active and d.is_active and a.status <> 'unavailable' and (a.url ~ ${DESIGN_TEAM_URL_PATTERN} or a.url ~ ${DESIGN_ADMIN_URL_PATTERN})`);
  const r = rowsOf<{ team_access: boolean; admin_access: boolean; admin_app_admin: boolean }>(res)[0];
  return { teamAccess: !!r?.team_access, adminAccess: !!r?.admin_access, adminAppAdmin: !!r?.admin_app_admin };
}

async function departmentName(id: string | null): Promise<string | null> {
  if (!id) return null;
  const [d] = await db.select({ name: departments.name }).from(departments).where(eq(departments.id, id)).limit(1);
  return d?.name ?? null;
}

/** Who is asking and their roles here (see design.manifest.ts). Any signed-in hub user is "ok", with or without roles. */
export const resolveAccess = cache(async (): Promise<Access> => {
  const host = await hostCurrentUser();
  if (!host) return { status: "anonymous" };
  const [s, department] = await Promise.all([standing(host.id), departmentName(host.homeDepartmentId)]);
  const roles = designRolesFor({ hubRole: host.role, teamAccess: s.teamAccess, adminAccess: s.adminAccess, adminAppAdmin: s.adminAppAdmin });
  return { status: "ok", user: { id: host.id, name: host.name, email: host.email, roles, hubRole: host.role, department } };
});

/** Whether the person is still on the temporary password they were emailed. */
export const needsOwnPassword = async () => !!(await hostCurrentUser())?.mustChangePassword;

/** Everyone given Design Admin (the creative team, who work on requests), by name. */
export async function listDesigners(): Promise<Person[]> {
  return db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(sql`${users.id} in (${appHolders(DESIGN_ADMIN_URL_PATTERN)})`).orderBy(asc(users.name));
}

/** The App Admins of Design Admin who also hold it (the leads), by name. With none, the Support Admins stand in, so nothing goes unnoticed. */
export async function listLeads(): Promise<Person[]> {
  const leads = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(sql`${users.id} in (${appHolders(DESIGN_ADMIN_URL_PATTERN)}) and ${users.id} in (select aa.user_id from app_admins aa join apps a on a.id = aa.app_id where a.url ~ ${DESIGN_ADMIN_URL_PATTERN})`)
    .orderBy(asc(users.name));
  if (leads.length) return leads;
  return db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(and(eq(users.role, "head_admin"), eq(users.isActive, true), eq(users.status, "approved")));
}

/** Who a ticket may be given to: the creative team (leads hold Design Admin too). */
export async function listAssignable(): Promise<Person[]> {
  const [d, l] = await Promise.all([listDesigners(), listLeads()]);
  const byId = new Map([...d, ...l].map((p) => [p.id, p]));
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function isAssignable(userId: string): Promise<boolean> {
  return (await listAssignable()).some((p) => p.id === userId);
}

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
  await notifyUsers(notices.map((n) => ({ userId: n.userId, kind: "design", title: n.title, body: n.body ?? null, link: n.link ?? null, dedupeKey: `design:${n.key}` })));
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

/** This site's address, for links in emails. */
export const siteUrl = () => hostSiteUrl();
