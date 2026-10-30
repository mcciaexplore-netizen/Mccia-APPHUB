import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { accessTemplateApps, accessTemplates, apps, branches, teams, userAppAccess, users, type User } from "@/db/schema";
import type { DirectoryProps } from "@/components/people/PeopleDirectory";
import { domainsLabel } from "@/lib/domains";
import { getCatalog } from "@/lib/catalog";
import { listAudit } from "@/lib/audit";
import { getPerson, listPeople, parsePeopleFilters } from "@/lib/people";
import { SINGLE_HOLDER_ROLES, canDeactivate, canEditPerson, canGrantAny, canManageAccess, capabilities, hasArea, isSuper } from "@/lib/rbac";

type SP = Record<string, string | string[] | undefined>;

/** What each approving role does in the Approval System (shown on the person's profile). Who approves follows these roles, in code. */
const RESPONSIBILITIES: Partial<Record<User["role"], string[]>> = {
  hr_admin: ["Reviews every HR request first, then rejects it or recommends it to the Super Admin"],
  expense_admin: ["Approves or rejects expenses below ₹10,000", "Reviews expenses of ₹10,000 and above, then rejects them or recommends them to the Super Admin"],
  super_admin: ["Gives the final decision on HR requests and on expenses of ₹10,000 and above"],
};

/** The applications this person may hand out: all of them for the super administrator, only the ones they hold for a team manager. */
async function grantableCatalog(actor: Pick<User, "id" | "role">) {
  const catalog = await getCatalog();
  if (canGrantAny(actor)) return catalog;
  const own = new Set((await db.select({ appId: userAppAccess.appId }).from(userAppAccess).where(eq(userAppAccess.userId, actor.id))).map((r) => r.appId));
  const appsList = catalog.apps.filter((a) => own.has(a.id));
  const deps = new Set(appsList.map((a) => a.departmentId));
  return { departments: catalog.departments.filter((d) => deps.has(d.id)), apps: appsList };
}

const loadOptions = async () => {
  const [brs, tms, appList, holders] = await Promise.all([
    db.select({ id: branches.id, name: branches.name }).from(branches).orderBy(asc(branches.name)),
    db.select({ id: teams.id, name: teams.name }).from(teams).orderBy(asc(teams.name)),
    db.select({ id: apps.id, name: apps.name }).from(apps).orderBy(asc(apps.name)),
    // Who holds the roles only one person may have, so the Role dropdown can say "taken by ...".
    db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(inArray(users.role, [...SINGLE_HOLDER_ROLES])),
  ]);
  return { branches: brs, teams: tms, apps: appList, roleHolders: holders.map((h) => ({ id: h.id, name: h.name, role: h.role })) };
};

/** Who can be picked as a reporting manager: every active person for the two top roles; plain users and Team managers for an Admin (who never sees the others). */
const loadManagers = (actor: Pick<User, "role">) =>
  db.select({ id: users.id, name: users.name, email: users.email }).from(users)
    .where(and(eq(users.isActive, true), eq(users.status, "approved"), isSuper(actor) ? undefined : inArray(users.role, ["member", "dept_lead"])))
    .orderBy(asc(users.name)).limit(5000);

async function loadTemplates(allowed?: Set<string>) {
  const [list, rows] = await Promise.all([db.select().from(accessTemplates).orderBy(asc(accessTemplates.name)), db.select().from(accessTemplateApps)]);
  return list.map((t) => ({ id: t.id, name: t.name, appIds: rows.filter((x) => x.templateId === t.id && (!allowed || allowed.has(x.appId))).map((x) => x.appId) }));
}

/** Everything the directory screen needs, for the administrator (/administrator/users) or a team manager (/team). */
export async function loadDirectory(actor: User, sp: SP, base: string): Promise<DirectoryProps> {
  const filters = parsePeopleFilters(sp);
  const full = canGrantAny(actor);
  const [result, options, catalog, managers] = await Promise.all([
    listPeople(actor, filters),
    loadOptions(),
    grantableCatalog(actor),
    full ? loadManagers(actor) : Promise.resolve([]),
  ]);
  const templates = await loadTemplates(full ? undefined : new Set(catalog.apps.map((a) => a.id)));
  return {
    base, result, filters, options: { ...options, managers }, catalog, templates, domains: domainsLabel(), meId: actor.id,
    caps: capabilities(actor),
  };
}

/** Everything the profile screen needs for one person, or null when this actor may not see them (the page then shows "not found"). */
export async function loadProfile(actor: User, id: string, base: string) {
  const person = await getPerson(actor, id);
  if (!person) return null;
  const full = canGrantAny(actor);
  const [options, managers, catalog, names, auditRows] = await Promise.all([
    loadOptions(),
    full ? loadManagers(actor) : Promise.resolve([]),
    grantableCatalog(actor),
    db.select({ id: apps.id, name: apps.name }).from(apps),
    hasArea(actor, "audit") ? listAudit({ page: 1, targetId: id }, 10) : Promise.resolve(null),
  ]);
  const templates = await loadTemplates(full ? undefined : new Set(catalog.apps.map((a) => a.id)));
  const inCatalog = new Set(catalog.apps.map((a) => a.id));
  const nameOf = new Map(names.map((a) => [a.id, a.name]));
  return {
    base, person, catalog, templates, meId: actor.id,
    options: { branches: options.branches, teams: options.teams, managers, roleHolders: options.roleHolders },
    // What the buttons on this one person's page show: the actor's general abilities, narrowed to what they may do to THIS person.
    caps: { ...capabilities(actor), editPerson: canEditPerson(actor, person), invite: canEditPerson(actor, person), toggleActive: canDeactivate(actor, person) },
    accessEditable: canManageAccess(actor, { id: person.id, role: person.role, teamId: person.teamId, reportingManagerId: person.managerId }),
    appNames: person.appIds.map((a) => nameOf.get(a) ?? "").filter(Boolean).sort(),
    otherApps: person.appIds.filter((a) => !inCatalog.has(a)).length,
    responsibilities: RESPONSIBILITIES[person.role] ?? [],
    audit: auditRows ? auditRows.rows.map((r) => ({ id: r.id, at: r.at, actorName: r.actorName, action: r.action, details: r.details })) : null,
  };
}
