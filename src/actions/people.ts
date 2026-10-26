"use server";

import { randomBytes } from "node:crypto";
import { and, count, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { apps, branches, teams, userAppAccess, users, type User } from "@/db/schema";
import { applyAccess, previewAccess, type AccessMode, MAX_PEOPLE } from "@/lib/access-ops";
import { createAccount } from "@/lib/accounts";
import { adminAction, staffAction, UserError } from "@/lib/action";
import { writeAudit } from "@/lib/audit";
import { envRoleIsFixed, isEnvAdmin } from "@/lib/auth";
import { domainsLabel, isEmailAllowed } from "@/lib/domains";
import { BATCH_ROWS, checkImport, commitBatch, type ImportPolicy } from "@/lib/import";
import { deliverInvite, hashToken, sendInvite } from "@/lib/invites";
import { roleLabel } from "@/lib/format";
import type { Role } from "@/db/schema";
import { notifyUsers } from "@/lib/notifications";
import { checkOrg } from "@/lib/org";
import { hashPassword, passwordSchema } from "@/lib/passwords";
import { parsePeopleFilters, peopleIds } from "@/lib/people";
import { ADMIN_AREAS, AREA_LABEL, ASSIGNABLE_ROLES, canChangeRole, canDeactivate, canEditPerson, canManageAccess, isSupport, PROMOTABLE_ROLES, SINGLE_HOLDER_ROLES } from "@/lib/rbac";
import { emailSchema, uuid, uuidList } from "@/lib/validation";

/**
 * Everything an administrator does to people. Each action proves who is asking, then asks src/lib/rbac.ts whether that person may do
 * it to that target, then does it, then records it in the audit log (never a password, token or link).
 */

const optionalText = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);
const optionalId = uuid.nullish().transform((v) => v ?? null);
const role = z.enum([...ASSIGNABLE_ROLES, ...PROMOTABLE_ROLES]);
const PROMOTED = new Set<string>(PROMOTABLE_ROLES);
/** Making someone an Admin, the Super Admin, the HR Admin or the Expense Admin is the Support Admin's alone. */
function checkMayGiveRole(admin: Pick<User, "role">, wanted: string) {
  if (PROMOTED.has(wanted) && !isSupport(admin)) throw new UserError("Only the Support Admin can give that role.");
}

/** The Super Admin, the HR Admin and the Expense Admin are one person each: another person holding the role must be changed first. */
async function checkSingleHolder(wanted: string, personId: string | null) {
  if (!(SINGLE_HOLDER_ROLES as readonly string[]).includes(wanted)) return;
  const [holder] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.role, wanted as Role));
  if (holder && holder.id !== personId) throw new UserError(`${holder.name} is already the ${roleLabel[wanted as Role]}. Only one person can have this role: change ${holder.name}'s role first.`);
}

function checkDomain(email: string) {
  if (!isEmailAllowed(email)) throw new UserError(`Email must end with ${domainsLabel()}`);
}

/** Readable names for the audit record, so it still makes sense after a branch or manager is renamed or removed. */
async function orgNames(f: { branchId: string | null; teamId: string | null; managerId: string | null }) {
  const one = async <T extends { name: string }>(id: string | null, q: (i: string) => Promise<T[]>) => (id ? ((await q(id))[0]?.name ?? null) : null);
  const [branch, team, manager] = await Promise.all([
    one(f.branchId, (i) => db.select({ name: branches.name }).from(branches).where(eq(branches.id, i))),
    one(f.teamId, (i) => db.select({ name: teams.name }).from(teams).where(eq(teams.id, i))),
    one(f.managerId, (i) => db.select({ name: users.name }).from(users).where(eq(users.id, i))),
  ]);
  return { branch, team, manager };
}

// ------------------------------------------------------------------------------------------------ adding and editing people

const newPerson = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: emailSchema,
  designation: optionalText(120),
  role: role.default("member"),
  branchId: optionalId, teamId: optionalId, managerId: optionalId,
  appIds: uuidList.default([]),
  /** Leave empty to send a setup link. Only for someone who cannot receive email. */
  password: z.string().max(200).optional().default(""),
  /** When no password is chosen: create the invitation now (true), or create the account without one (false). */
  invite: z.boolean().default(true),
});

export type AddResult = { id: string; delivery: "sent" | "failed" | "manual" | "none"; link: string | null };

/** One person. They choose their own password from a one-time link, unless the administrator deliberately sets one. */
export async function addPerson(input: unknown) {
  return adminAction("people", async (admin): Promise<AddResult> => {
    const v = newPerson.parse(input);
    checkMayGiveRole(admin, v.role);
    await checkSingleHolder(v.role, null);
    checkDomain(v.email);
    if (isEnvAdmin(v.email)) throw new UserError("That address is a main admin account, which is set in the environment settings.");
    const org = await checkOrg({ branchId: v.branchId, teamId: v.teamId, managerId: v.managerId }, null);
    const appIds = [...new Set(v.appIds)];
    if (appIds.length) {
      const found = await db.select({ id: apps.id }).from(apps).where(inArray(apps.id, appIds));
      if (found.length !== appIds.length) throw new UserError("One or more applications no longer exist. Reload and try again.");
    }
    const password = v.password.trim();
    const passwordHash = password ? await hashPassword(passwordSchema.parse(password)) : null;
    const token = !passwordHash && v.invite ? randomBytes(32).toString("base64url") : null;
    const id = await createAccount(admin, {
      name: v.name, email: v.email, role: v.role, branchId: org.branchId, teamId: org.teamId, managerId: org.managerId,
      designation: v.designation, appIds, passwordHash, inviteTokenHash: token ? hashToken(token) : null, source: "admin",
    });
    if (!id) throw new UserError("That email already has an account.");

    const names = await orgNames(org);
    const appNames = appIds.length ? (await db.select({ name: apps.name }).from(apps).where(inArray(apps.id, appIds))).map((a) => a.name).sort() : [];
    await writeAudit(admin, [
      { action: "user.create", targetType: "user", targetId: id, targetLabel: v.name, details: { source: "admin", role: v.role, ...names, credential: passwordHash ? "password set by administrator" : token ? "setup link" : "none yet" } },
      ...(appNames.length ? [{ action: "access.change", targetType: "user" as const, targetId: id, targetLabel: v.name, details: { source: "create", mode: "add", added: appNames, removed: [], before: [], after: appNames } }] : []),
    ]);
    if (!token) return { id, delivery: "none", link: null };
    const { delivery, link } = await deliverInvite({ name: v.name, email: v.email }, token);
    return { id, delivery, link };
  });
}

const personEdit = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  designation: optionalText(120),
  branchId: optionalId, teamId: optionalId, managerId: optionalId,
  role: role.optional(),
});

/** Name, designation, branch, team, reporting manager and (for the Support Admin) role. Email never changes. */
export async function updatePerson(id: string, input: unknown) {
  return adminAction("people", async (admin) => {
    uuid.parse(id);
    const v = personEdit.parse(input);
    const [cur] = await db.select().from(users).where(eq(users.id, id));
    if (!cur) throw new UserError("User not found.");
    if (!canEditPerson(admin, cur)) throw new UserError("You cannot change that person's details.");
    const org = await checkOrg(
      { branchId: v.branchId, teamId: v.teamId, managerId: v.managerId }, id,
      { branchId: cur.branchId, teamId: cur.teamId, managerId: cur.reportingManagerId },
    );
    const newRole = v.role ?? cur.role;
    if (newRole !== cur.role && envRoleIsFixed(cur.email)) throw new UserError("This account is the Support Admin or the Super Admin set in the environment settings, so its role is put back at every sign-in. Change it there, in Vercel.");
    if (newRole !== cur.role && !canChangeRole(admin, cur)) throw new UserError("That person's role cannot be changed here. Only the Support Admin changes roles.");
    if (newRole !== cur.role) await checkSingleHolder(newRole, id);
    const before = await orgNames({ branchId: cur.branchId, teamId: cur.teamId, managerId: cur.reportingManagerId });
    const after = await orgNames(org);
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const note = (k: string, from: unknown, to: unknown) => { if ((from ?? null) !== (to ?? null)) changes[k] = { from: from ?? null, to: to ?? null }; };
    note("name", cur.name, v.name); note("designation", cur.designation, v.designation); note("role", cur.role, newRole);
    for (const k of ["branch", "team", "manager"] as const) note(k, before[k], after[k]);
    if (Object.keys(changes).length === 0) return;
    await db.update(users).set({ name: v.name, designation: v.designation, branchId: org.branchId, teamId: org.teamId, reportingManagerId: org.managerId, role: newRole, adminAreas: newRole === "admin" ? cur.adminAreas : [] }).where(eq(users.id, id));
    await writeAudit(admin, [{ action: "user.update", targetType: "user", targetId: id, targetLabel: v.name, details: { changes } }]);
    if (newRole !== cur.role) {
      await notifyUsers([{ userId: id, kind: "role_changed", title: "Your role changed", body: `Your role in the App Hub is now ${roleLabel[newRole]}.`, link: "/", dedupeKey: `role:${newRole}:${Math.floor(Date.now() / 60000)}` }]);
    }
  });
}

/** A deactivated person is signed out at once and can be activated again. */
export async function setPersonActive(id: string, active: boolean) {
  return adminAction("people", async (admin) => {
    uuid.parse(id);
    const [u] = await db.select({ name: users.name, email: users.email, role: users.role, isActive: users.isActive }).from(users).where(eq(users.id, id));
    if (!u) throw new UserError("User not found.");
    if (!canEditPerson(admin, { id, role: u.role })) throw new UserError("You cannot change that person's account.");
    if (!active && !canDeactivate(admin, { id, role: u.role })) throw new UserError("You cannot deactivate that person.");
    if (!active && u.role === "head_admin") {
      const [{ n }] = await db.select({ n: count() }).from(users).where(and(eq(users.role, "head_admin"), eq(users.isActive, true), ne(users.id, id)));
      if (n === 0) throw new UserError("There must always be at least one active Support Admin.");
    }
    if (u.isActive === !!active) return;
    await db.update(users).set({ isActive: !!active }).where(eq(users.id, id));
    await writeAudit(admin, [{ action: active ? "user.activate" : "user.deactivate", targetType: "user", targetId: id, targetLabel: u.name }]);
  });
}

/**
 * Permanently removes a person: their account, password and access. Their activity stays in the history as an unknown user.
 * The Support Admin may delete anyone, the Super Admin and the main accounts included, except themselves and the last Support Admin. An account that is set in the
 * environment settings is made again the next time it is needed (at its next sign-in) unless its settings are also removed in Vercel. Deactivating is the reversible alternative.
 */
export async function deletePerson(id: string) {
  return adminAction(async (admin) => {
    uuid.parse(id);
    const [u] = await db.select({ name: users.name, email: users.email, role: users.role }).from(users).where(eq(users.id, id));
    if (!u) throw new UserError("User not found.");
    if (id === admin.id) throw new UserError("You cannot delete your own account.");
    if (u.role === "head_admin") {
      const [{ n }] = await db.select({ n: count() }).from(users).where(and(eq(users.role, "head_admin"), eq(users.isActive, true), ne(users.id, id)));
      if (n === 0) throw new UserError("There must always be at least one active Support Admin.");
    }
    await db.delete(users).where(eq(users.id, id));
    await writeAudit(admin, [{ action: "user.delete", targetType: "user", targetId: id, targetLabel: u.name, details: { email: u.email, role: u.role } }]);
  });
}

const areaList = z.array(z.enum(ADMIN_AREAS)).max(ADMIN_AREAS.length);

/**
 * What an Admin may open in Administrator: the ticks the Support Admin sets for them. Only the Support Admin does this, and only for an
 * Admin. It is recorded in the audit log with what was switched on and off.
 */
export async function setAdminAreas(id: string, areas: unknown) {
  return adminAction(async (admin) => {
    if (!isSupport(admin)) throw new UserError("Only the Support Admin can change what an Admin may do.");
    uuid.parse(id);
    const next = [...new Set(areaList.parse(areas))].sort((a, b) => ADMIN_AREAS.indexOf(a) - ADMIN_AREAS.indexOf(b));
    const [u] = await db.select({ name: users.name, role: users.role, adminAreas: users.adminAreas }).from(users).where(eq(users.id, id));
    if (!u) throw new UserError("User not found.");
    if (u.role !== "admin") throw new UserError("Only an Admin has areas to switch on. Make them an Admin first.");
    const before = u.adminAreas;
    const added = next.filter((a) => !before.includes(a));
    const removed = before.filter((a) => !(next as string[]).includes(a));
    if (added.length === 0 && removed.length === 0) return;
    await db.update(users).set({ adminAreas: next }).where(eq(users.id, id));
    await writeAudit(admin, [{ action: "user.admin_areas", targetType: "user", targetId: id, targetLabel: u.name, details: { added, removed, before, after: next } }]);
    await notifyUsers([{ userId: id, kind: "admin_areas_changed", title: "What you may open in Administrator changed", body: next.length ? `You can now open: ${next.map((a) => AREA_LABEL[a].title).join(", ")}.` : "Nothing is switched on for you in Administrator.", link: "/", dedupeKey: `areas:${next.join(",")}:${Math.floor(Date.now() / 60000)}` }]);
  });
}

/** For someone who cannot receive email: the administrator types a password. It is hashed at once and never recorded anywhere. */
export async function setPersonPassword(id: string, password: unknown) {
  return adminAction("people", async (admin) => {
    uuid.parse(id);
    const pw = passwordSchema.parse(password);
    const [u] = await db.select({ name: users.name, email: users.email, role: users.role }).from(users).where(eq(users.id, id));
    if (!u) throw new UserError("User not found.");
    if (!canEditPerson(admin, { id, role: u.role })) throw new UserError("You cannot change that person's password.");
    if (isEnvAdmin(u.email)) throw new UserError("This account's password is set in the environment settings.");
    await db.update(users).set({ passwordHash: await hashPassword(pw) }).where(eq(users.id, id)); // also signs them out everywhere
    await writeAudit(admin, [{ action: "user.password_set", targetType: "user", targetId: id, targetLabel: u.name }]);
  });
}

export type LinkResult = { id: string; name: string; email: string; ok: boolean; delivery: "sent" | "failed" | "manual" | null; link: string | null; message: string };

async function inviteOne(admin: User, id: string): Promise<LinkResult> {
  const [u] = await db.select({ id: users.id, name: users.name, email: users.email, isActive: users.isActive, role: users.role }).from(users).where(eq(users.id, id));
  if (!u) return { id, name: "", email: "", ok: false, delivery: null, link: null, message: "User not found." };
  if (!canEditPerson(admin, u)) return { id, name: u.name, email: u.email, ok: false, delivery: null, link: null, message: "You cannot send a setup link to that person." };
  try {
    const r = await sendInvite(u, admin.id);
    await writeAudit(admin, [{ action: "user.invite", targetType: "user", targetId: id, targetLabel: u.name, details: { delivery: r.delivery } }]);
    return { id, name: u.name, email: u.email, ok: true, delivery: r.delivery, link: r.link, message: r.delivery === "sent" ? "Email sent." : r.delivery === "failed" ? "The email could not be sent. Pass the link on yourself." : "No email is set up. Pass the link on yourself." };
  } catch (e) {
    return { id, name: u.name, email: u.email, ok: false, delivery: null, link: null, message: e instanceof UserError ? e.message : "Could not create a link." };
  }
}

/** A fresh one-time link for one person (new account, or a forgotten password). Any older link stops working. */
export async function sendSetupLink(id: string) {
  return adminAction("people", async (admin) => inviteOne(admin, uuid.parse(id)));
}

/** The same for several people at once: the directory's bulk action for people still pending. */
export async function sendSetupLinks(ids: unknown) {
  return adminAction("people", async (admin): Promise<LinkResult[]> => {
    const list = [...new Set(uuidList.min(1, "Select at least one person").max(200, "Choose at most 200 people at a time").parse(ids))];
    const out: LinkResult[] = [];
    for (let i = 0; i < list.length; i += 5) out.push(...(await Promise.all(list.slice(i, i + 5).map((id) => inviteOne(admin, id)))));
    return out;
  });
}

// ------------------------------------------------------------------------------------------------ assigning applications

const target = z.object({
  ids: uuidList.default([]), teamId: uuid.optional(), branchId: uuid.optional(), managerId: uuid.optional(),
  /** The directory's current filters as a query string, to mean "everyone matching these". */
  filterQuery: z.string().max(2000).optional(),
});
const assignment = target.extend({ appIds: uuidList.default([]), mode: z.enum(["add", "remove", "replace"]) });
export type AssignTarget = z.input<typeof target>;

/** Resolves who a request means and makes sure every one of them is someone the actor may manage. */
async function resolveTarget(actor: User, t: z.infer<typeof target>): Promise<string[]> {
  const filters = t.filterQuery ? parsePeopleFilters(Object.fromEntries(new URLSearchParams(t.filterQuery))) : undefined;
  const ids = await peopleIds(actor, { ids: t.ids, teamId: t.teamId, branchId: t.branchId, managerId: t.managerId, filters });
  if (ids.length === 0) throw new UserError("No one matches that selection.");
  if (ids.length > MAX_PEOPLE) throw new UserError(`That is more than ${MAX_PEOPLE} people. Narrow the selection.`);
  return ids;
}

export type SelectionStatus = { people: number; names: string[]; perApp: Record<string, number> };

/** For the first step: how many of the chosen people already have each application. */
export async function selectionStatus(input: unknown) {
  return staffAction(async (actor): Promise<SelectionStatus> => {
    const ids = await resolveTarget(actor, target.parse(input));
    const targets = await db.select({ id: users.id, name: users.name, role: users.role, teamId: users.teamId, reportingManagerId: users.reportingManagerId }).from(users).where(inArray(users.id, ids));
    if (targets.some((t) => !canManageAccess(actor, t))) throw new UserError("You are not allowed to change access for everyone in that selection.");
    const rows = await db.select({ appId: userAppAccess.appId, n: count() }).from(userAppAccess).where(inArray(userAppAccess.userId, ids)).groupBy(userAppAccess.appId);
    return { people: ids.length, names: targets.map((t) => t.name).sort().slice(0, 8), perApp: Object.fromEntries(rows.map((r) => [r.appId, r.n])) };
  });
}

/** The review step: exactly who would get and lose what. Writes nothing. */
export async function previewAssignment(input: unknown) {
  return staffAction(async (actor) => {
    const v = assignment.parse(input);
    return previewAccess(actor, { userIds: await resolveTarget(actor, v), appIds: v.appIds, mode: v.mode as AccessMode, source: "directory" });
  });
}

/** Saves the change, all of it or none of it, and says who changed. */
export async function assignApps(input: unknown) {
  return staffAction(async (actor) => {
    const v = assignment.parse(input);
    return applyAccess(actor, { userIds: await resolveTarget(actor, v), appIds: v.appIds, mode: v.mode as AccessMode, source: "directory" });
  });
}

/** The profile page: make one person's access exactly the ticked applications. */
export async function setPersonAccess(userId: string, appIds: unknown) {
  return staffAction(async (actor) => applyAccess(actor, { userIds: [uuid.parse(userId)], appIds: uuidList.parse(appIds), mode: "replace", source: "profile" }));
}

// ------------------------------------------------------------------------------------------------ bulk add

const importRows = z.array(z.object({
  row: z.number().int().min(1).max(100000),
  name: z.string().max(300), email: z.string().max(300), branch: z.string().max(200), team: z.string().max(200),
  manager: z.string().max(300), role: z.string().max(100), applications: z.string().max(2000), designation: z.string().max(300),
})).min(1).max(2000);
const policy = z.object({ existing: z.enum(["skip", "update"]) });

/** Reads every row and reports what is wrong or what would happen. Writes nothing. */
export async function checkImportAction(rows: unknown, existing: unknown) {
  return adminAction("import", async (admin) => checkImport(admin, importRows.parse(rows), policy.parse({ existing }) as ImportPolicy));
}

/** Creates the accounts for some of the rows (the caller sends the whole file each time, plus the row numbers to do now). */
export async function commitImportAction(rows: unknown, existing: unknown, only: unknown, invite: unknown) {
  return adminAction("import", async (admin) => commitBatch(
    admin, importRows.parse(rows), policy.parse({ existing }) as ImportPolicy,
    z.array(z.number().int()).min(1).max(BATCH_ROWS).parse(only), { invite: z.boolean().parse(invite) },
  ));
}
